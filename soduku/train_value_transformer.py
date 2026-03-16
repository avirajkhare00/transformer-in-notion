#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from torch.utils.data import DataLoader

from structured_transformer_common import (
    StructuredSudokuTransformer,
    default_device,
    export_model,
    load_structured_dataset_bundle,
    set_seed,
    train_model,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train and export a structured Sudoku hard-set PLACE-value transformer."
    )
    parser.add_argument("--dataset", type=Path, default=Path("soduku/training/hard-value-dataset.json"))
    parser.add_argument("--raw-dir", type=Path, default=Path("soduku/training/hard-value-structured"))
    parser.add_argument("--export-dir", type=Path, default=Path("soduku/models/hard-value-structured"))
    parser.add_argument("--epochs", type=int, default=24)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--lr", type=float, default=8e-4)
    parser.add_argument("--target-accuracy", type=float, default=0.70)
    parser.add_argument("--log-every", type=int, default=100)
    parser.add_argument("--checkpoint-dir", type=Path)
    parser.add_argument("--checkpoint-every", type=int, default=1)
    parser.add_argument("--resume-from-checkpoint", type=Path)
    parser.add_argument("--seed", type=int, default=23)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    set_seed(args.seed)

    dataset_path = args.dataset.resolve()
    raw_dir = args.raw_dir.resolve()
    export_dir = args.export_dir.resolve()
    checkpoint_dir = args.checkpoint_dir.resolve() if args.checkpoint_dir else None
    resume_from_checkpoint = (
        args.resume_from_checkpoint.resolve() if args.resume_from_checkpoint else None
    )

    if not dataset_path.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_path}")

    bundle = load_structured_dataset_bundle(dataset_path, "valueLabels")
    if bundle.train_count < 1 or bundle.eval_count < 1:
        raise RuntimeError(
            f"Dataset split is empty for {dataset_path}: train={bundle.train_count} eval={bundle.eval_count}."
        )

    train_loader = DataLoader(
        bundle.train_dataset,
        batch_size=args.batch_size,
        shuffle=not bundle.streaming,
    )
    eval_loader = DataLoader(
        bundle.eval_dataset, batch_size=args.batch_size, shuffle=False
    )
    device = default_device()

    print(
        "training structured value model on "
        f"{device} with train={bundle.train_count} eval={bundle.eval_count} "
        f"format={bundle.metadata['format']} batch_size={args.batch_size} "
        f"log_every={args.log_every}",
        flush=True,
    )

    model = StructuredSudokuTransformer(num_labels=len(bundle.label_names))
    model, metrics = train_model(
        model=model,
        train_loader=train_loader,
        eval_loader=eval_loader,
        device=device,
        epochs=args.epochs,
        learning_rate=args.lr,
        target_accuracy=args.target_accuracy,
        log_every=args.log_every,
        train_count=bundle.train_count,
        eval_count=bundle.eval_count,
        batch_size=args.batch_size,
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=args.checkpoint_every,
        resume_from_checkpoint=resume_from_checkpoint,
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
        metadata=bundle.metadata,
        label_names=bundle.label_names,
        train_count=bundle.train_count,
        eval_count=bundle.eval_count,
    )

    print(
        f"exported structured value model to {export_dir} with accuracy={metrics['accuracy']:.4f} "
        f"and train_loss={metrics['train_loss']:.4f}",
        flush=True,
    )


if __name__ == "__main__":
    main()
