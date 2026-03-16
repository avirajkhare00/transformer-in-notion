#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from torch.utils.data import DataLoader

from structured_transformer_common import (
    StructuredSudokuTransformer,
    build_tensor_dataset,
    default_device,
    export_model,
    load_structured_dataset,
    set_seed,
    train_model,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train and export a structured Sudoku hard-set next-op transformer."
    )
    parser.add_argument("--dataset", type=Path, default=Path("soduku/training/hard-op-dataset.json"))
    parser.add_argument("--raw-dir", type=Path, default=Path("soduku/training/hard-op-structured"))
    parser.add_argument("--export-dir", type=Path, default=Path("soduku/models/hard-op-structured"))
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--lr", type=float, default=8e-4)
    parser.add_argument("--target-accuracy", type=float, default=0.90)
    parser.add_argument("--seed", type=int, default=17)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    set_seed(args.seed)

    dataset_path = args.dataset.resolve()
    raw_dir = args.raw_dir.resolve()
    export_dir = args.export_dir.resolve()

    if not dataset_path.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_path}")

    train_samples, eval_samples, label_names, metadata = load_structured_dataset(
        dataset_path, "opLabels"
    )

    train_loader = DataLoader(
        build_tensor_dataset(train_samples), batch_size=args.batch_size, shuffle=True
    )
    eval_loader = DataLoader(
        build_tensor_dataset(eval_samples), batch_size=args.batch_size, shuffle=False
    )
    device = default_device()

    print(
        "training structured op model on "
        f"{device} with train={train_samples.count} eval={eval_samples.count} "
        f"eval_puzzles={metadata['evalPuzzleIds']}"
    )

    model = StructuredSudokuTransformer(num_labels=len(label_names))
    model, metrics = train_model(
        model=model,
        train_loader=train_loader,
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

    export_model(
        model=model,
        raw_dir=raw_dir,
        export_dir=export_dir,
        metrics=metrics,
        metadata=metadata,
        label_names=label_names,
        train_count=train_samples.count,
        eval_count=eval_samples.count,
    )

    print(
        f"exported structured op model to {export_dir} with accuracy={metrics['accuracy']:.4f} "
        f"and train_loss={metrics['train_loss']:.4f}"
    )


if __name__ == "__main__":
    main()
