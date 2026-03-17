#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DEFAULT_MODEL_DIR = REPO_ROOT / "invoice/training/invoice-total-selector"
DEFAULT_EXTRACTOR = SCRIPT_DIR / "extract_receipt_total_candidates.mjs"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Predict receipt totals using the PSVM candidate extractor and a local selector model.")
    parser.add_argument("inputs", nargs="+", help="PDF or OCR text files")
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument(
        "--extractor",
        type=Path,
        default=DEFAULT_EXTRACTOR,
        help="Node extractor that emits candidate contexts as JSON",
    )
    parser.add_argument("--json", action="store_true")
    return parser.parse_args()


def load_candidates(extractor: Path, inputs: list[str]) -> list[dict]:
    command = ["node", str(extractor.resolve()), "--json", *inputs]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def score_receipt_candidates(
    receipt: dict,
    tokenizer: AutoTokenizer,
    model: AutoModelForSequenceClassification,
    device: torch.device,
    positive_label: int,
) -> dict:
    contexts = [candidate["context"] for candidate in receipt["candidates"]]
    encoded = tokenizer(
        contexts,
        padding=True,
        truncation=True,
        max_length=min(getattr(model.config, "max_position_embeddings", 256), 256),
        return_tensors="pt",
    )
    encoded = {name: value.to(device) for name, value in encoded.items()}
    with torch.no_grad():
        outputs = model(**encoded)
        probabilities = outputs.logits.softmax(dim=-1)[:, positive_label].detach().cpu().tolist()

    ranked = sorted(
        [
            {
                **candidate,
                "modelScore": probability,
            }
            for candidate, probability in zip(receipt["candidates"], probabilities, strict=True)
        ],
        key=lambda candidate: candidate["modelScore"],
        reverse=True,
    )
    return {
        "inputPath": receipt["inputPath"],
        "documentType": receipt["documentType"],
        "teacherTotalText": receipt["teacherTotalText"],
        "teacherTotalCents": receipt["teacherTotalCents"],
        "predictedTotalText": ranked[0]["amountText"],
        "predictedTotalCents": ranked[0]["amountCents"],
        "predictedLineText": ranked[0]["lineText"],
        "predictedScore": ranked[0]["modelScore"],
        "topCandidates": ranked[:5],
    }


def main() -> None:
    args = parse_args()
    model_dir = args.model_dir.resolve()
    if not model_dir.exists():
        raise FileNotFoundError(f"Model directory not found: {model_dir}")

    tokenizer = AutoTokenizer.from_pretrained(model_dir)
    model = AutoModelForSequenceClassification.from_pretrained(model_dir)

    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    model.to(device)
    model.eval()

    positive_label = model.config.label2id.get("TOTAL", 1)
    receipts = load_candidates(args.extractor, args.inputs)
    predictions = [
      score_receipt_candidates(receipt, tokenizer, model, device, positive_label)
      for receipt in receipts
    ]

    if args.json:
        print(json.dumps(predictions, indent=2))
        return

    for prediction in predictions:
        print(prediction["inputPath"])
        print(
            f"Model total: {prediction['predictedTotalText']} "
            f"(score={prediction['predictedScore']:.4f}, {prediction['documentType']})"
        )
        print(f"Teacher total: {prediction['teacherTotalText']}")
        print(f"Chosen line: {prediction['predictedLineText']}")
        for candidate in prediction["topCandidates"]:
            print(
                f"  model={candidate['modelScore']:.4f} teacher={candidate['score']:.2f} "
                f"amount={candidate['amountText']} line={candidate['lineIndex'] + 1} {candidate['lineText']}"
            )
        print("")


if __name__ == "__main__":
    main()
