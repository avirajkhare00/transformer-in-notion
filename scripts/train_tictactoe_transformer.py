#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import random
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import torch
from tokenizers import Tokenizer
from tokenizers.models import WordLevel
from tokenizers.pre_tokenizers import Whitespace
from tokenizers.processors import TemplateProcessing
from torch.utils.data import DataLoader, TensorDataset
from transformers import BertConfig, BertForSequenceClassification, PreTrainedTokenizerFast

VOCAB = {
    "[PAD]": 0,
    "[UNK]": 1,
    "[CLS]": 2,
    "[SEP]": 3,
    "[MASK]": 4,
    "X": 5,
    "O": 6,
    ".": 7,
}

MOVE_LABELS = {index: f"move_{index}" for index in range(9)}


@dataclass
class SampleSet:
    texts: list[str]
    labels: list[int]


def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)


def load_dataset(dataset_path: Path) -> SampleSet:
    payload = json.loads(dataset_path.read_text())
    texts = [sample["board"] for sample in payload["samples"]]
    labels = [int(sample["bestMove"]) for sample in payload["samples"]]
    return SampleSet(texts=texts, labels=labels)


def build_tokenizer() -> PreTrainedTokenizerFast:
    tokenizer = Tokenizer(WordLevel(vocab=VOCAB, unk_token="[UNK]"))
    tokenizer.pre_tokenizer = Whitespace()
    tokenizer.post_processor = TemplateProcessing(
        single="[CLS] $A [SEP]",
        special_tokens=[("[CLS]", VOCAB["[CLS]"]), ("[SEP]", VOCAB["[SEP]"])],
    )

    return PreTrainedTokenizerFast(
        tokenizer_object=tokenizer,
        unk_token="[UNK]",
        pad_token="[PAD]",
        cls_token="[CLS]",
        sep_token="[SEP]",
        mask_token="[MASK]",
    )


def encode_dataset(tokenizer: PreTrainedTokenizerFast, samples: SampleSet) -> dict[str, torch.Tensor]:
    encoded = tokenizer(
        samples.texts,
        padding="max_length",
        truncation=True,
        max_length=16,
        return_tensors="pt",
    )
    encoded["labels"] = torch.tensor(samples.labels, dtype=torch.long)
    return encoded


def build_model() -> BertForSequenceClassification:
    config = BertConfig(
        vocab_size=len(VOCAB),
        hidden_size=128,
        num_hidden_layers=4,
        num_attention_heads=8,
        intermediate_size=256,
        max_position_embeddings=32,
        type_vocab_size=2,
        num_labels=9,
        pad_token_id=VOCAB["[PAD]"],
        label2id={label: index for index, label in MOVE_LABELS.items()},
        id2label=MOVE_LABELS,
        classifier_dropout=0.0,
        hidden_dropout_prob=0.0,
        attention_probs_dropout_prob=0.0,
    )
    return BertForSequenceClassification(config)


def evaluate(model: BertForSequenceClassification, dataloader: DataLoader, device: torch.device) -> tuple[float, float]:
    model.eval()
    total = 0
    correct = 0
    total_loss = 0.0

    with torch.no_grad():
        for batch in dataloader:
            input_ids, attention_mask, labels = (tensor.to(device) for tensor in batch)
            outputs = model(input_ids=input_ids, attention_mask=attention_mask, labels=labels)
            predictions = outputs.logits.argmax(dim=-1)
            correct += (predictions == labels).sum().item()
            total += labels.size(0)
            total_loss += outputs.loss.item() * labels.size(0)

    return correct / total, total_loss / total


def train_model(
    model: BertForSequenceClassification,
    train_loader: DataLoader,
    eval_loader: DataLoader,
    device: torch.device,
    epochs: int,
    learning_rate: float,
    target_accuracy: float,
) -> tuple[BertForSequenceClassification, dict[str, float]]:
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=0.0)
    best_accuracy = 0.0
    best_state = None
    last_train_loss = 0.0

    model.to(device)

    for epoch in range(1, epochs + 1):
        model.train()
        running_loss = 0.0
        sample_count = 0

        for batch in train_loader:
            input_ids, attention_mask, labels = (tensor.to(device) for tensor in batch)
            outputs = model(input_ids=input_ids, attention_mask=attention_mask, labels=labels)
            loss = outputs.loss
            loss.backward()
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)

            batch_size = labels.size(0)
            running_loss += loss.item() * batch_size
            sample_count += batch_size

        last_train_loss = running_loss / sample_count
        accuracy, eval_loss = evaluate(model, eval_loader, device)
        print(
            f"epoch={epoch:02d} train_loss={last_train_loss:.4f} "
            f"eval_loss={eval_loss:.4f} accuracy={accuracy:.4f}"
        )

        if accuracy >= best_accuracy:
            best_accuracy = accuracy
            best_state = {name: tensor.detach().cpu().clone() for name, tensor in model.state_dict().items()}

        if accuracy >= target_accuracy:
            break

    if best_state is None:
        raise RuntimeError("Training did not produce a checkpoint.")

    model.load_state_dict(best_state)
    metrics = {
        "accuracy": best_accuracy,
        "train_loss": last_train_loss,
    }
    return model, metrics


def save_and_export(
    model: BertForSequenceClassification,
    tokenizer: PreTrainedTokenizerFast,
    raw_dir: Path,
    export_dir: Path,
    metrics: dict[str, float],
    sample_count: int,
) -> None:
    if raw_dir.exists():
        shutil.rmtree(raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)

    model.save_pretrained(raw_dir)
    tokenizer.save_pretrained(raw_dir)
    (raw_dir / "metadata.json").write_text(
        json.dumps({"sampleCount": sample_count, **metrics}, indent=2)
    )

    if export_dir.exists():
        shutil.rmtree(export_dir)
    export_dir.mkdir(parents=True, exist_ok=True)
    onnx_dir = export_dir / "onnx"

    optimum_cli = Path(sys.executable).parent / "optimum-cli"
    command = [
        str(optimum_cli),
        "export",
        "onnx",
        "--model",
        str(raw_dir),
        "--task",
        "text-classification",
        str(onnx_dir),
    ]
    subprocess.run(command, check=True)

    for filename in [
        "config.json",
        "special_tokens_map.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "metadata.json",
    ]:
      source = raw_dir / filename
      if source.exists():
          shutil.copy2(source, export_dir / filename)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train and export a tiny tic-tac-toe transformer.")
    parser.add_argument("--dataset", type=Path, default=Path("training/tictactoe-dataset.json"))
    parser.add_argument("--raw-dir", type=Path, default=Path("training/tictactoe-bert"))
    parser.add_argument("--export-dir", type=Path, default=Path("models/tictactoe-bert"))
    parser.add_argument("--epochs", type=int, default=180)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--target-accuracy", type=float, default=0.995)
    parser.add_argument("--seed", type=int, default=7)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    set_seed(args.seed)

    dataset_path = args.dataset.resolve()
    raw_dir = args.raw_dir.resolve()
    export_dir = args.export_dir.resolve()

    if not dataset_path.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_path}")

    samples = load_dataset(dataset_path)
    tokenizer = build_tokenizer()
    encoded = encode_dataset(tokenizer, samples)

    dataset = TensorDataset(
        encoded["input_ids"],
        encoded["attention_mask"],
        encoded["labels"],
    )
    dataloader = DataLoader(dataset, batch_size=args.batch_size, shuffle=True)
    eval_loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=False)

    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    print(f"training on {device} with {len(samples.texts)} samples")

    model = build_model()
    model, metrics = train_model(
        model=model,
        train_loader=dataloader,
        eval_loader=eval_loader,
        device=device,
        epochs=args.epochs,
        learning_rate=args.lr,
        target_accuracy=args.target_accuracy,
    )

    if metrics["accuracy"] < args.target_accuracy:
        raise RuntimeError(
            f"Model accuracy {metrics['accuracy']:.4f} did not reach target {args.target_accuracy:.4f}."
        )

    save_and_export(
        model=model,
        tokenizer=tokenizer,
        raw_dir=raw_dir,
        export_dir=export_dir,
        metrics=metrics,
        sample_count=len(samples.texts),
    )

    print(
        f"exported model to {export_dir} with accuracy={metrics['accuracy']:.4f} "
        f"and train_loss={metrics['train_loss']:.4f}"
    )


if __name__ == "__main__":
    main()
