#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import torch

from structured_transformer_common import PACKED_FORMAT, _sample_to_features


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Pack a streamed structured Sudoku JSONL manifest into tensor shard files."
    )
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--output-manifest", type=Path)
    parser.add_argument("--shard-rows", type=int, default=65536)
    return parser.parse_args()


def derive_defaults(dataset_path: Path) -> tuple[Path, Path]:
    if not dataset_path.name.endswith("-manifest.json"):
        raise RuntimeError(f"Expected a *-manifest.json dataset, got {dataset_path.name}")
    packed_dir = dataset_path.parent / dataset_path.name.replace("-manifest.json", "-packed")
    packed_manifest = dataset_path.parent / dataset_path.name.replace(
        "-manifest.json", "-packed-manifest.json"
    )
    return packed_dir, packed_manifest


def _stack_samples(samples: list[dict]) -> dict[str, torch.Tensor]:
    board_tokens = torch.tensor([sample["board_tokens"] for sample in samples], dtype=torch.uint8)
    focus_row = torch.tensor([sample["focus_row"] for sample in samples], dtype=torch.uint8)
    focus_col = torch.tensor([sample["focus_col"] for sample in samples], dtype=torch.uint8)
    candidate_mask = torch.tensor([sample["candidate_mask"] for sample in samples], dtype=torch.uint8)
    history_ops = torch.tensor([sample["history_ops"] for sample in samples], dtype=torch.uint8)
    filled_count = torch.tensor([sample["filled_count"] for sample in samples], dtype=torch.uint8)
    search_depth = torch.tensor([sample["search_depth"] for sample in samples], dtype=torch.uint8)
    labels = torch.tensor([sample["label"] for sample in samples], dtype=torch.uint8)
    return {
        "board_tokens": board_tokens,
        "focus_row": focus_row,
        "focus_col": focus_col,
        "candidate_mask": candidate_mask,
        "history_ops": history_ops,
        "filled_count": filled_count,
        "search_depth": search_depth,
        "labels": labels,
    }


def _flush_shard(
    *,
    samples: list[dict],
    split: str,
    shard_index: int,
    output_dir: Path,
    manifest_dir: Path,
) -> dict:
    shard_path = output_dir / f"{split}-{shard_index:05d}.pt"
    torch.save(_stack_samples(samples), shard_path)
    return {
        "path": str(shard_path.relative_to(manifest_dir)),
        "count": len(samples),
    }


def _pack_split(
    *,
    manifest_dir: Path,
    jsonl_path: Path,
    output_dir: Path,
    split: str,
    shard_rows: int,
) -> list[dict]:
    shards: list[dict] = []
    shard_samples: list[dict] = []

    with jsonl_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped:
                continue
            sample, _ = _sample_to_features(json.loads(stripped))
            shard_samples.append(sample)
            if len(shard_samples) >= shard_rows:
                shards.append(
                    _flush_shard(
                        samples=shard_samples,
                        split=split,
                        shard_index=len(shards),
                        output_dir=output_dir,
                        manifest_dir=manifest_dir,
                    )
                )
                shard_samples = []

    if shard_samples:
        shards.append(
            _flush_shard(
                samples=shard_samples,
                split=split,
                shard_index=len(shards),
                output_dir=output_dir,
                manifest_dir=manifest_dir,
            )
        )

    return shards


def main() -> None:
    args = parse_args()
    dataset_path = args.dataset.resolve()
    if not dataset_path.exists():
        raise FileNotFoundError(f"Dataset manifest not found: {dataset_path}")
    if args.shard_rows < 1:
        raise RuntimeError("--shard-rows must be a positive integer.")

    payload = json.loads(dataset_path.read_text())
    if payload.get("format") == PACKED_FORMAT:
        print(f"{dataset_path} is already packed.")
        return
    if payload.get("format") != "structured-state-v1-jsonl":
        raise RuntimeError(f"Unsupported format in {dataset_path}: {payload.get('format')}")

    default_output_dir, default_output_manifest = derive_defaults(dataset_path)
    output_dir = args.output_dir.resolve() if args.output_dir else default_output_dir
    output_manifest = (
        args.output_manifest.resolve() if args.output_manifest else default_output_manifest
    )

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest_dir = output_manifest.parent
    train_path = (dataset_path.parent / payload["trainPath"]).resolve()
    eval_path = (dataset_path.parent / payload["evalPath"]).resolve()

    train_shards = _pack_split(
        manifest_dir=manifest_dir,
        jsonl_path=train_path,
        output_dir=output_dir,
        split="train",
        shard_rows=args.shard_rows,
    )
    eval_shards = _pack_split(
        manifest_dir=manifest_dir,
        jsonl_path=eval_path,
        output_dir=output_dir,
        split="eval",
        shard_rows=args.shard_rows,
    )

    packed_manifest = {
        **payload,
        "format": PACKED_FORMAT,
        "packedFrom": str(dataset_path.name),
        "shardRows": int(args.shard_rows),
        "trainShards": train_shards,
        "evalShards": eval_shards,
    }
    packed_manifest.pop("trainPath", None)
    packed_manifest.pop("evalPath", None)

    output_manifest.write_text(json.dumps(packed_manifest, indent=2))
    print(
        f"packed {dataset_path.name} -> {output_manifest.name} "
        f"with train_shards={len(train_shards)} eval_shards={len(eval_shards)}"
    )


if __name__ == "__main__":
    main()
