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
        description="Train and export a structured Sudoku hard-set next-op transformer."
    )
    parser.add_argument("--dataset", type=Path, default=Path("soduku/training/hard-op-dataset.json"))
    parser.add_argument("--raw-dir", type=Path, default=Path("soduku/training/hard-op-structured"))
    parser.add_argument("--export-dir", type=Path, default=Path("soduku/models/hard-op-structured"))
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--lr", type=float, default=8e-4)
    parser.add_argument("--target-accuracy", type=float, default=0.90)
    parser.add_argument("--log-every", type=int, default=100)
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--prefetch-factor", type=int, default=4)
    parser.add_argument("--checkpoint-dir", type=Path)
    parser.add_argument("--checkpoint-every", type=int, default=1)
    parser.add_argument("--resume-from-checkpoint", type=Path)
    parser.add_argument("--seed", type=int, default=17)
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

    bundle = load_structured_dataset_bundle(
        dataset_path,
        "opLabels",
        batch_size=args.batch_size,
    )
    if bundle.train_count < 1 or bundle.eval_count < 1:
        raise RuntimeError(
            f"Dataset split is empty for {dataset_path}: train={bundle.train_count} eval={bundle.eval_count}."
        )

    loader_kwargs = {}
    if args.num_workers > 0:
        loader_kwargs = {
            "num_workers": args.num_workers,
            "persistent_workers": True,
            "prefetch_factor": args.prefetch_factor,
        }

    if bundle.prebatched:
        train_loader = DataLoader(
            bundle.train_dataset,
            batch_size=None,
            **loader_kwargs,
        )
        eval_loader = DataLoader(
            bundle.eval_dataset,
            batch_size=None,
            **loader_kwargs,
        )
    else:
        train_loader = DataLoader(
            bundle.train_dataset,
            batch_size=args.batch_size,
            shuffle=not bundle.streaming,
            **loader_kwargs,
        )
        eval_loader = DataLoader(
            bundle.eval_dataset,
            batch_size=args.batch_size,
            shuffle=False,
            **loader_kwargs,
        )
    device = default_device()

    print(
        "training structured op model on "
        f"{device} with train={bundle.train_count} eval={bundle.eval_count} "
        f"format={bundle.metadata['format']} batch_size={args.batch_size} "
        f"log_every={args.log_every} num_workers={args.num_workers} "
        f"prebatched={bundle.prebatched}",
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
        f"exported structured op model to {export_dir} with accuracy={metrics['accuracy']:.4f} "
        f"and train_loss={metrics['train_loss']:.4f}",
        flush=True,
    )


if __name__ == "__main__":
    main()
