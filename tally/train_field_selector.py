#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import random
import shutil
from dataclasses import dataclass
from pathlib import Path

import torch
import torch.nn.functional as F
from tokenizers import Tokenizer
from tokenizers.models import WordLevel
from tokenizers.pre_tokenizers import Whitespace
from tokenizers.processors import TemplateProcessing
from torch.utils.data import DataLoader, TensorDataset
from transformers import BertConfig, BertForSequenceClassification, PreTrainedTokenizerFast

SPECIAL_TOKENS = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]"]


@dataclass
class SampleSet:
    texts: list[str]
    labels: list[int]
    group_ids: list[str]


def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)


def load_dataset(dataset_path: Path) -> tuple[SampleSet, list[str]]:
    payload = json.loads(dataset_path.read_text())
    samples = payload["samples"]
    return (
        SampleSet(
            texts=[sample["context"] for sample in samples],
            labels=[int(sample["label"]) for sample in samples],
            group_ids=[sample["groupId"] for sample in samples],
        ),
        list(payload["labelNames"]),
    )


def split_dataset_by_group(samples: SampleSet, eval_ratio: float, seed: int) -> tuple[SampleSet, SampleSet]:
    group_ids = sorted(set(samples.group_ids))
    random.Random(seed).shuffle(group_ids)
    eval_size = max(1, int(len(group_ids) * eval_ratio))
    eval_ids = set(group_ids[:eval_size])

    train_texts: list[str] = []
    train_labels: list[int] = []
    train_group_ids: list[str] = []
    eval_texts: list[str] = []
    eval_labels: list[int] = []
    eval_group_ids: list[str] = []

    for text, label, group_id in zip(samples.texts, samples.labels, samples.group_ids, strict=True):
        if group_id in eval_ids:
            eval_texts.append(text)
            eval_labels.append(label)
            eval_group_ids.append(group_id)
        else:
            train_texts.append(text)
            train_labels.append(label)
            train_group_ids.append(group_id)

    return (
        SampleSet(train_texts, train_labels, train_group_ids),
        SampleSet(eval_texts, eval_labels, eval_group_ids),
    )


def build_vocab(texts: list[str]) -> dict[str, int]:
    vocab = {token: index for index, token in enumerate(SPECIAL_TOKENS)}
    tokens = sorted({token for text in texts for token in text.split()})
    for token in tokens:
        if token not in vocab:
            vocab[token] = len(vocab)
    return vocab


def build_tokenizer(vocab: dict[str, int]) -> PreTrainedTokenizerFast:
    tokenizer = Tokenizer(WordLevel(vocab=vocab, unk_token="[UNK]"))
    tokenizer.pre_tokenizer = Whitespace()
    tokenizer.post_processor = TemplateProcessing(
        single="[CLS] $A [SEP]",
        special_tokens=[("[CLS]", vocab["[CLS]"]), ("[SEP]", vocab["[SEP]"])],
    )
    return PreTrainedTokenizerFast(
        tokenizer_object=tokenizer,
        unk_token="[UNK]",
        pad_token="[PAD]",
        cls_token="[CLS]",
        sep_token="[SEP]",
        mask_token="[MASK]",
    )


def compute_max_length(texts: list[str]) -> int:
    token_count = max(len(text.split()) for text in texts)
    return max(64, min(256, token_count + 2))


def encode_dataset(
    tokenizer: PreTrainedTokenizerFast,
    samples: SampleSet,
    max_length: int,
) -> dict[str, torch.Tensor]:
    encoded = tokenizer(
        samples.texts,
        padding="max_length",
        truncation=True,
        max_length=max_length,
        return_tensors="pt",
    )
    encoded["labels"] = torch.tensor(samples.labels, dtype=torch.long)
    encoded["example_ids"] = torch.arange(len(samples.texts), dtype=torch.long)
    return encoded


def build_model(vocab_size: int, label_names: list[str]) -> BertForSequenceClassification:
    id2label = {index: label for index, label in enumerate(label_names)}
    label2id = {label: index for index, label in id2label.items()}
    config = BertConfig(
        vocab_size=vocab_size,
        hidden_size=128,
        num_hidden_layers=4,
        num_attention_heads=8,
        intermediate_size=256,
        max_position_embeddings=256,
        type_vocab_size=2,
        num_labels=len(label_names),
        pad_token_id=0,
        label2id=label2id,
        id2label=id2label,
        classifier_dropout=0.0,
        hidden_dropout_prob=0.0,
        attention_probs_dropout_prob=0.0,
    )
    return BertForSequenceClassification(config)


def build_class_weights(labels: list[int], label_count: int) -> torch.Tensor:
    counts = [0 for _ in range(label_count)]
    for label in labels:
        counts[label] += 1

    total = sum(counts)
    weights = []
    for count in counts:
        if count == 0:
            weights.append(0.0)
        else:
            weights.append(total / (label_count * count))

    return torch.tensor(weights, dtype=torch.float32)


def evaluate(
    model: BertForSequenceClassification,
    dataloader: DataLoader,
    samples: SampleSet,
    device: torch.device,
    positive_label: int,
    class_weights: torch.Tensor,
) -> tuple[float, float, float]:
    model.eval()
    total = 0
    correct = 0
    total_loss = 0.0
    group_scores: dict[str, list[tuple[float, int]]] = {}

    with torch.no_grad():
        for batch in dataloader:
            input_ids, attention_mask, labels, example_ids = (tensor.to(device) for tensor in batch)
            outputs = model(input_ids=input_ids, attention_mask=attention_mask)
            loss = F.cross_entropy(outputs.logits, labels, weight=class_weights.to(device))
            predictions = outputs.logits.argmax(dim=-1)
            probabilities = outputs.logits.softmax(dim=-1)[:, positive_label]

            correct += (predictions == labels).sum().item()
            total += labels.size(0)
            total_loss += loss.item() * labels.size(0)

            for example_id, probability, label in zip(
                example_ids.detach().cpu().tolist(),
                probabilities.detach().cpu().tolist(),
                labels.detach().cpu().tolist(),
                strict=True,
            ):
                group_id = samples.group_ids[example_id]
                group_scores.setdefault(group_id, []).append((probability, label))

    group_correct = 0
    for candidates in group_scores.values():
        best_probability, best_label = max(candidates, key=lambda candidate: candidate[0])
        if best_label == positive_label:
            group_correct += 1

    return (
        correct / total,
        total_loss / total,
        group_correct / max(1, len(group_scores)),
    )


def train_model(
    model: BertForSequenceClassification,
    train_loader: DataLoader,
    eval_loader: DataLoader,
    eval_samples: SampleSet,
    device: torch.device,
    epochs: int,
    learning_rate: float,
    target_group_accuracy: float,
    min_epochs: int,
    positive_label: int,
    class_weights: torch.Tensor,
) -> tuple[BertForSequenceClassification, dict[str, float]]:
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=0.0)
    best_group_accuracy = 0.0
    best_sample_accuracy = 0.0
    best_score = -1.0
    best_state = None
    best_metrics = {"sample_accuracy": 0.0, "group_accuracy": 0.0, "train_loss": 0.0}

    model.to(device)
    class_weights = class_weights.to(device)

    for epoch in range(1, epochs + 1):
        model.train()
        running_loss = 0.0
        sample_count = 0

        for batch in train_loader:
            input_ids, attention_mask, labels, _example_ids = (tensor.to(device) for tensor in batch)
            outputs = model(input_ids=input_ids, attention_mask=attention_mask)
            loss = F.cross_entropy(outputs.logits, labels, weight=class_weights)
            loss.backward()
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)

            batch_size = labels.size(0)
            running_loss += loss.item() * batch_size
            sample_count += batch_size

        train_loss = running_loss / sample_count
        sample_accuracy, eval_loss, group_accuracy = evaluate(
            model,
            eval_loader,
            eval_samples,
            device,
            positive_label,
            class_weights,
        )
        print(
            f"epoch={epoch:02d} train_loss={train_loss:.4f} "
            f"eval_loss={eval_loss:.4f} sample_accuracy={sample_accuracy:.4f} "
            f"group_accuracy={group_accuracy:.4f}",
            flush=True,
        )

        combined_score = group_accuracy + sample_accuracy
        if combined_score > best_score or (
            combined_score == best_score and group_accuracy >= best_group_accuracy
        ):
            best_score = combined_score
            best_group_accuracy = group_accuracy
            best_sample_accuracy = sample_accuracy
            best_state = {name: tensor.detach().cpu().clone() for name, tensor in model.state_dict().items()}
            best_metrics = {
                "sample_accuracy": sample_accuracy,
                "group_accuracy": group_accuracy,
                "train_loss": train_loss,
            }

        if epoch >= min_epochs and group_accuracy >= target_group_accuracy:
            break

    if best_state is None:
        raise RuntimeError("Training did not produce a checkpoint.")

    model.load_state_dict(best_state)
    return model, best_metrics


class SequenceClassificationOnnxWrapper(torch.nn.Module):
    def __init__(self, model: BertForSequenceClassification) -> None:
        super().__init__()
        self.model = model

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        return self.model(input_ids=input_ids, attention_mask=attention_mask).logits


def export_raw_checkpoint(raw_dir: Path, export_dir: Path) -> None:
    if export_dir.exists():
        shutil.rmtree(export_dir)
    export_dir.mkdir(parents=True, exist_ok=True)
    onnx_dir = export_dir / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)

    model = BertForSequenceClassification.from_pretrained(raw_dir)
    wrapper = SequenceClassificationOnnxWrapper(model)
    wrapper.eval()
    wrapper.cpu()

    model_path = onnx_dir / "model.onnx"
    example_input_ids = torch.zeros((1, 8), dtype=torch.long)
    example_attention_mask = torch.ones((1, 8), dtype=torch.long)
    torch.onnx.export(
        wrapper,
        (example_input_ids, example_attention_mask),
        model_path,
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            "logits": {0: "batch"},
        },
        opset_version=17,
        external_data=False,
    )
    shutil.copy2(model_path, onnx_dir / "model_quantized.onnx")

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


def save_and_export(
    model: BertForSequenceClassification,
    tokenizer: PreTrainedTokenizerFast,
    raw_dir: Path,
    export_dir: Path,
    metrics: dict[str, float],
    sample_count: int,
    train_count: int,
    eval_count: int,
    skip_export: bool,
) -> None:
    if raw_dir.exists():
        shutil.rmtree(raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)

    model.save_pretrained(raw_dir)
    tokenizer.save_pretrained(raw_dir)
    (raw_dir / "metadata.json").write_text(
        json.dumps(
            {
                "sampleCount": sample_count,
                "trainCount": train_count,
                "evalCount": eval_count,
                **metrics,
            },
            indent=2,
        )
    )

    if skip_export:
        return

    export_raw_checkpoint(raw_dir, export_dir)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train and export a PSVM-style Tally field selector.")
    parser.add_argument("--dataset", type=Path, default=Path("tally/training/tally-field-dataset.json"))
    parser.add_argument("--raw-dir", type=Path, default=Path("tally/training/tally-field-selector"))
    parser.add_argument("--export-dir", type=Path, default=Path("tally/models/tally-field-selector"))
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--min-epochs", type=int, default=4)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--target-group-accuracy", type=float, default=0.95)
    parser.add_argument("--eval-ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=31)
    parser.add_argument("--skip-export", action="store_true")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda", "mps"], default="auto")
    parser.add_argument("--export-only", action="store_true")
    return parser.parse_args()


def resolve_device(device_name: str) -> torch.device:
    if device_name == "auto":
        if torch.cuda.is_available():
            return torch.device("cuda")
        if torch.backends.mps.is_available():
            return torch.device("mps")
        return torch.device("cpu")

    if device_name == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested but is not available in this Python environment.")
        return torch.device("cuda")

    if device_name == "mps":
        if not torch.backends.mps.is_built():
            raise RuntimeError("MPS was requested but this PyTorch build was not compiled with MPS support.")
        if not torch.backends.mps.is_available():
            raise RuntimeError("MPS was requested but is not available to this process.")
        return torch.device("mps")

    return torch.device("cpu")


def main() -> None:
    args = parse_args()
    set_seed(args.seed)

    dataset_path = args.dataset.resolve()
    raw_dir = args.raw_dir.resolve()
    export_dir = args.export_dir.resolve()

    if args.export_only:
        if not raw_dir.exists():
            raise FileNotFoundError(f"Raw checkpoint not found: {raw_dir}")
        export_raw_checkpoint(raw_dir, export_dir)
        print(f"exported model to {export_dir} from raw checkpoint {raw_dir}", flush=True)
        return

    if not dataset_path.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_path}")

    samples, label_names = load_dataset(dataset_path)
    train_samples, eval_samples = split_dataset_by_group(samples, eval_ratio=args.eval_ratio, seed=args.seed)

    vocab = build_vocab(train_samples.texts + eval_samples.texts)
    tokenizer = build_tokenizer(vocab)
    max_length = compute_max_length(train_samples.texts + eval_samples.texts)
    class_weights = build_class_weights(train_samples.labels, len(label_names))

    train_encoded = encode_dataset(tokenizer, train_samples, max_length=max_length)
    eval_encoded = encode_dataset(tokenizer, eval_samples, max_length=max_length)

    train_dataset = TensorDataset(
        train_encoded["input_ids"],
        train_encoded["attention_mask"],
        train_encoded["labels"],
        train_encoded["example_ids"],
    )
    eval_dataset = TensorDataset(
        eval_encoded["input_ids"],
        eval_encoded["attention_mask"],
        eval_encoded["labels"],
        eval_encoded["example_ids"],
    )

    train_loader = DataLoader(train_dataset, batch_size=args.batch_size, shuffle=True)
    eval_loader = DataLoader(eval_dataset, batch_size=args.batch_size, shuffle=False)

    device = resolve_device(args.device)

    positive_label = label_names.index("SELECTED")
    print(
        f"training on {device} with train={len(train_samples.texts)} eval={len(eval_samples.texts)} "
        f"train_groups={len(set(train_samples.group_ids))} eval_groups={len(set(eval_samples.group_ids))} "
        f"max_length={max_length} vocab={len(vocab)}",
        flush=True,
    )

    model = build_model(vocab_size=len(vocab), label_names=label_names)
    model, metrics = train_model(
        model=model,
        train_loader=train_loader,
        eval_loader=eval_loader,
        eval_samples=eval_samples,
        device=device,
        epochs=args.epochs,
        learning_rate=args.lr,
        target_group_accuracy=args.target_group_accuracy,
        min_epochs=args.min_epochs,
        positive_label=positive_label,
        class_weights=class_weights,
    )

    if metrics["group_accuracy"] < args.target_group_accuracy:
        raise RuntimeError(
            f"Group accuracy {metrics['group_accuracy']:.4f} did not reach target {args.target_group_accuracy:.4f}."
        )

    save_and_export(
        model=model,
        tokenizer=tokenizer,
        raw_dir=raw_dir,
        export_dir=export_dir,
        metrics=metrics,
        sample_count=len(samples.texts),
        train_count=len(train_samples.texts),
        eval_count=len(eval_samples.texts),
        skip_export=args.skip_export,
    )

    export_message = "raw checkpoint only" if args.skip_export else f"exported model to {export_dir}"
    print(
        f"{export_message} with group_accuracy={metrics['group_accuracy']:.4f} "
        f"sample_accuracy={metrics['sample_accuracy']:.4f} train_loss={metrics['train_loss']:.4f}",
        flush=True,
    )


if __name__ == "__main__":
    main()
