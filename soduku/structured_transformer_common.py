from __future__ import annotations

import json
import random
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import torch
from torch import nn
from torch.nn import functional as F
from torch.utils.data import DataLoader, IterableDataset, TensorDataset, get_worker_info

BOARD_LENGTH = 81
BOARD_SIDE = 9
BOX_SIDE = 3
CANDIDATE_LENGTH = 9
HISTORY_LENGTH = 8
FOCUS_NONE = 0
BOARD_VOCAB = 10
FOCUS_VOCAB = 10
BINARY_VOCAB = 2
HISTORY_VOCAB = 4
COUNT_VOCAB = 82
DEPTH_VOCAB = 82
INPUT_NAMES = [
    "board_tokens",
    "focus_row",
    "focus_col",
    "candidate_mask",
    "history_ops",
    "filled_count",
    "search_depth",
]
STRUCTURED_TENSOR_NAMES = [*INPUT_NAMES, "labels"]
PACKED_FORMAT = "structured-state-v1-ptshards"
SUPPORTED_MODEL_ARCHITECTURES = ("transformer", "gnn")


def _build_sudoku_graph() -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    row_ids: list[int] = []
    col_ids: list[int] = []
    box_ids: list[int] = []
    adjacency = torch.zeros((BOARD_LENGTH, BOARD_LENGTH), dtype=torch.float32)

    for row in range(BOARD_SIDE):
        for col in range(BOARD_SIDE):
            index = row * BOARD_SIDE + col
            row_ids.append(row)
            col_ids.append(col)
            box_ids.append((row // BOX_SIDE) * BOX_SIDE + (col // BOX_SIDE))

            neighbors = {index}
            for peer in range(BOARD_SIDE):
                neighbors.add(row * BOARD_SIDE + peer)
                neighbors.add(peer * BOARD_SIDE + col)
            box_row = (row // BOX_SIDE) * BOX_SIDE
            box_col = (col // BOX_SIDE) * BOX_SIDE
            for box_r in range(box_row, box_row + BOX_SIDE):
                for box_c in range(box_col, box_col + BOX_SIDE):
                    neighbors.add(box_r * BOARD_SIDE + box_c)

            weight = 1.0 / len(neighbors)
            for neighbor in neighbors:
                adjacency[index, neighbor] = weight

    return (
        torch.tensor(row_ids, dtype=torch.long),
        torch.tensor(col_ids, dtype=torch.long),
        torch.tensor(box_ids, dtype=torch.long),
        adjacency,
    )


SUDOKU_ROW_IDS, SUDOKU_COL_IDS, SUDOKU_BOX_IDS, SUDOKU_ADJACENCY = _build_sudoku_graph()
SUDOKU_NODE_INDICES = torch.arange(BOARD_LENGTH, dtype=torch.long)


@dataclass
class StructuredSampleSet:
    board_tokens: torch.Tensor
    focus_row: torch.Tensor
    focus_col: torch.Tensor
    candidate_mask: torch.Tensor
    history_ops: torch.Tensor
    filled_count: torch.Tensor
    search_depth: torch.Tensor
    labels: torch.Tensor

    @property
    def count(self) -> int:
        return int(self.labels.shape[0])


@dataclass
class StructuredDatasetBundle:
    train_dataset: TensorDataset | IterableDataset
    eval_dataset: TensorDataset | IterableDataset
    train_count: int
    eval_count: int
    label_names: list[str]
    metadata: dict
    streaming: bool
    prebatched: bool = False


def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)


def _sample_to_features(sample: dict) -> tuple[list[int], int]:
    board_tokens = [int(value) for value in sample["boardTokens"]]
    candidate_mask = [int(value) for value in sample["candidateMask"]]
    history_ops = [int(value) for value in sample["historyOps"]]

    if len(board_tokens) != BOARD_LENGTH:
      raise ValueError(f"Expected {BOARD_LENGTH} board tokens, got {len(board_tokens)}")
    if len(candidate_mask) != CANDIDATE_LENGTH:
      raise ValueError(
          f"Expected {CANDIDATE_LENGTH} candidate values, got {len(candidate_mask)}"
      )
    if len(history_ops) != HISTORY_LENGTH:
      raise ValueError(f"Expected {HISTORY_LENGTH} history ops, got {len(history_ops)}")

    features = {
        "board_tokens": board_tokens,
        "focus_row": int(sample["focusRow"]),
        "focus_col": int(sample["focusCol"]),
        "candidate_mask": candidate_mask,
        "history_ops": history_ops,
        "filled_count": int(sample["filledCount"]),
        "search_depth": int(sample.get("searchDepth", 0)),
        "label": int(sample["label"]),
    }
    return features, features["label"]


def load_structured_dataset(
    dataset_path: Path, label_key: str
) -> tuple[StructuredSampleSet, StructuredSampleSet, list[str], dict]:
    payload = json.loads(dataset_path.read_text())
    train_features: list[dict] = []
    eval_features: list[dict] = []

    for sample in payload["samples"]:
        features, _ = _sample_to_features(sample)
        if sample["split"] == "eval":
            eval_features.append(features)
        else:
            train_features.append(features)

    metadata = {
        "sampleCount": int(payload["sampleCount"]),
        "trainPuzzleIds": list(payload["trainPuzzleIds"]),
        "evalPuzzleIds": list(payload["evalPuzzleIds"]),
        "limitPerPuzzle": int(payload["limitPerPuzzle"]),
        "historyWindow": int(payload["historyWindow"]),
        "format": payload.get("format", "structured-state-v1"),
    }

    return (
        to_structured_samples(train_features),
        to_structured_samples(eval_features),
        list(payload[label_key]),
        metadata,
    )


def _feature_dict_to_sample(features: dict) -> tuple[torch.Tensor, ...]:
    return (
        torch.tensor(features["board_tokens"], dtype=torch.long),
        torch.tensor(features["focus_row"], dtype=torch.long),
        torch.tensor(features["focus_col"], dtype=torch.long),
        torch.tensor(features["candidate_mask"], dtype=torch.long),
        torch.tensor(features["history_ops"], dtype=torch.long),
        torch.tensor(features["filled_count"], dtype=torch.long),
        torch.tensor(features["search_depth"], dtype=torch.long),
        torch.tensor(features["label"], dtype=torch.long),
    )


class StructuredJsonlDataset(IterableDataset):
    def __init__(self, jsonl_path: Path) -> None:
        super().__init__()
        self.jsonl_path = jsonl_path

    def __iter__(self):
        worker = get_worker_info()
        worker_id = worker.id if worker is not None else 0
        worker_count = worker.num_workers if worker is not None else 1
        file_size = self.jsonl_path.stat().st_size

        start = 0
        end = None
        if worker_count > 1 and file_size > 0:
            shard_size = file_size // worker_count
            start = shard_size * worker_id
            end = file_size if worker_id == worker_count - 1 else shard_size * (worker_id + 1)

        with self.jsonl_path.open("rb") as handle:
            if start > 0:
                handle.seek(start)
                handle.readline()

            while True:
                current = handle.tell()
                if end is not None and current >= end:
                    break

                raw_line = handle.readline()
                if not raw_line:
                    break

                line = raw_line.decode("utf-8").strip()
                if not line:
                    continue
                sample = json.loads(line)
                features, _ = _sample_to_features(sample)
                yield _feature_dict_to_sample(features)


class StructuredPackedBatchDataset(IterableDataset):
    def __init__(self, manifest_dir: Path, shards: list[dict], batch_size: int) -> None:
        super().__init__()
        self.manifest_dir = manifest_dir
        self.shards = shards
        self.batch_size = batch_size

    def __iter__(self):
        worker = get_worker_info()
        worker_id = worker.id if worker is not None else 0
        worker_count = worker.num_workers if worker is not None else 1
        assigned_shards = self.shards[worker_id::worker_count]

        for shard in assigned_shards:
            shard_path = (self.manifest_dir / shard["path"]).resolve()
            payload = torch.load(shard_path, map_location="cpu")
            tensors = tuple(
                payload[name].long() if payload[name].dtype != torch.long else payload[name]
                for name in STRUCTURED_TENSOR_NAMES
            )
            shard_count = int(tensors[-1].shape[0])
            for start in range(0, shard_count, self.batch_size):
                end = min(start + self.batch_size, shard_count)
                yield tuple(tensor[start:end] for tensor in tensors)


def _resolve_manifest_path(manifest_path: Path, child: str) -> Path:
    return (manifest_path.parent / child).resolve()


def _packed_manifest_candidate(dataset_path: Path) -> Path | None:
    if not dataset_path.name.endswith("-manifest.json"):
        return None
    return dataset_path.with_name(dataset_path.name.replace("-manifest.json", "-packed-manifest.json"))


def load_structured_dataset_bundle(
    dataset_path: Path,
    label_key: str,
    *,
    batch_size: int | None = None,
    prefer_packed: bool = True,
) -> StructuredDatasetBundle:
    resolved_path = dataset_path.resolve()
    if prefer_packed:
        packed_candidate = _packed_manifest_candidate(resolved_path)
        if packed_candidate is not None and packed_candidate.exists():
            resolved_path = packed_candidate

    payload = json.loads(resolved_path.read_text())

    if "samples" in payload:
        train_samples, eval_samples, label_names, metadata = load_structured_dataset(
            dataset_path, label_key
        )
        return StructuredDatasetBundle(
            train_dataset=build_tensor_dataset(train_samples),
            eval_dataset=build_tensor_dataset(eval_samples),
            train_count=train_samples.count,
            eval_count=eval_samples.count,
            label_names=label_names,
            metadata=metadata,
            streaming=False,
            prebatched=False,
        )

    if payload.get("format") == PACKED_FORMAT:
        if batch_size is None or batch_size < 1:
            raise RuntimeError("Packed structured datasets require a positive batch_size.")

        label_names = payload.get(label_key) or payload.get("labels")
        if not label_names:
            raise RuntimeError(f"Missing label list for {label_key} in {resolved_path}.")

        metadata = {
            "sampleCount": int(sum(payload["sampleCounts"].values()))
            if isinstance(payload.get("sampleCounts"), dict)
            else None,
            "trainPuzzleIds": [],
            "evalPuzzleIds": [],
            "limitPerPuzzle": int(payload.get("limitPuzzles", 0)),
            "historyWindow": int(payload["historyWindow"]),
            "format": payload.get("format", PACKED_FORMAT),
            "sourceCsv": payload.get("sourceCsv"),
            "evalPercent": payload.get("evalPercent"),
            "minRating": payload.get("minRating"),
            "packedFrom": payload.get("packedFrom"),
            "shardRows": payload.get("shardRows"),
        }

        return StructuredDatasetBundle(
            train_dataset=StructuredPackedBatchDataset(
                resolved_path.parent,
                list(payload["trainShards"]),
                batch_size=batch_size,
            ),
            eval_dataset=StructuredPackedBatchDataset(
                resolved_path.parent,
                list(payload["evalShards"]),
                batch_size=batch_size,
            ),
            train_count=int(payload["sampleCounts"]["trainOpSamples"])
            if label_key == "opLabels"
            else int(payload["sampleCounts"]["trainValueSamples"]),
            eval_count=int(payload["sampleCounts"]["evalOpSamples"])
            if label_key == "opLabels"
            else int(payload["sampleCounts"]["evalValueSamples"]),
            label_names=list(label_names),
            metadata=metadata,
            streaming=True,
            prebatched=True,
        )

    if payload.get("format") != "structured-state-v1-jsonl":
        raise RuntimeError(f"Unsupported structured dataset format in {resolved_path}.")

    train_path = _resolve_manifest_path(resolved_path, payload["trainPath"])
    eval_path = _resolve_manifest_path(resolved_path, payload["evalPath"])
    if not train_path.exists():
        raise FileNotFoundError(f"Train JSONL not found: {train_path}")
    if not eval_path.exists():
        raise FileNotFoundError(f"Eval JSONL not found: {eval_path}")

    label_names = payload.get(label_key) or payload.get("labels")
    if not label_names:
        raise RuntimeError(f"Missing label list for {label_key} in {resolved_path}.")

    metadata = {
        "sampleCount": int(sum(payload["sampleCounts"].values()))
        if isinstance(payload.get("sampleCounts"), dict)
        else None,
        "trainPuzzleIds": [],
        "evalPuzzleIds": [],
        "limitPerPuzzle": int(payload.get("limitPuzzles", 0)),
        "historyWindow": int(payload["historyWindow"]),
        "format": payload.get("format", "structured-state-v1-jsonl"),
        "sourceCsv": payload.get("sourceCsv"),
        "evalPercent": payload.get("evalPercent"),
        "minRating": payload.get("minRating"),
    }

    return StructuredDatasetBundle(
        train_dataset=StructuredJsonlDataset(train_path),
        eval_dataset=StructuredJsonlDataset(eval_path),
        train_count=int(payload["sampleCounts"]["trainOpSamples"])
        if label_key == "opLabels"
        else int(payload["sampleCounts"]["trainValueSamples"]),
        eval_count=int(payload["sampleCounts"]["evalOpSamples"])
        if label_key == "opLabels"
        else int(payload["sampleCounts"]["evalValueSamples"]),
        label_names=list(label_names),
        metadata=metadata,
        streaming=True,
        prebatched=False,
    )


def to_structured_samples(samples: list[dict]) -> StructuredSampleSet:
    if not samples:
        raise RuntimeError("Structured dataset split is empty.")

    def tensor_2d(key: str, width: int) -> torch.Tensor:
        values = []
        for sample in samples:
            row = sample[key]
            if len(row) != width:
                raise ValueError(f"{key} width mismatch: expected {width}, got {len(row)}")
            values.append(row)
        return torch.tensor(values, dtype=torch.long)

    def tensor_1d(key: str) -> torch.Tensor:
        return torch.tensor([sample[key] for sample in samples], dtype=torch.long)

    return StructuredSampleSet(
        board_tokens=tensor_2d("board_tokens", BOARD_LENGTH),
        focus_row=tensor_1d("focus_row"),
        focus_col=tensor_1d("focus_col"),
        candidate_mask=tensor_2d("candidate_mask", CANDIDATE_LENGTH),
        history_ops=tensor_2d("history_ops", HISTORY_LENGTH),
        filled_count=tensor_1d("filled_count"),
        search_depth=tensor_1d("search_depth"),
        labels=tensor_1d("label").to(torch.long),
    )


def build_tensor_dataset(samples: StructuredSampleSet) -> TensorDataset:
    return TensorDataset(
        samples.board_tokens,
        samples.focus_row,
        samples.focus_col,
        samples.candidate_mask,
        samples.history_ops,
        samples.filled_count,
        samples.search_depth,
        samples.labels,
    )


def _format_progress(current: int, total: int | None) -> str:
    if total is None or total <= 0:
        return str(current)
    return f"{current}/{total}"


def _estimated_batches(sample_count: int | None, batch_size: int | None) -> int | None:
    if sample_count is None or sample_count <= 0 or batch_size is None or batch_size <= 0:
        return None
    return (sample_count + batch_size - 1) // batch_size


def _clone_state_dict_to_cpu(model: nn.Module) -> dict[str, torch.Tensor]:
    return {name: tensor.detach().cpu().clone() for name, tensor in model.state_dict().items()}


def _save_training_checkpoint(
    checkpoint_path: Path,
    *,
    epoch: int,
    model: nn.Module,
    optimizer: torch.optim.Optimizer,
    best_state: dict[str, torch.Tensor] | None,
    best_accuracy: float,
    train_loss: float,
    eval_loss: float,
) -> None:
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "epoch": epoch,
        "model_state": _clone_state_dict_to_cpu(model),
        "optimizer_state": optimizer.state_dict(),
        "best_state": best_state,
        "best_accuracy": float(best_accuracy),
        "train_loss": float(train_loss),
        "eval_loss": float(eval_loss),
    }
    torch.save(payload, checkpoint_path)


def _optimizer_to_device(optimizer: torch.optim.Optimizer, device: torch.device) -> None:
    for state in optimizer.state.values():
        for key, value in state.items():
            if torch.is_tensor(value):
                state[key] = value.to(device)


def load_training_checkpoint(
    checkpoint_path: Path,
    *,
    model: nn.Module,
    optimizer: torch.optim.Optimizer,
    device: torch.device,
) -> tuple[int, dict[str, torch.Tensor] | None, float]:
    checkpoint = torch.load(checkpoint_path, map_location="cpu")
    model.load_state_dict(checkpoint["model_state"])
    optimizer.load_state_dict(checkpoint["optimizer_state"])
    _optimizer_to_device(optimizer, device)
    best_state = checkpoint.get("best_state")
    best_accuracy = float(checkpoint.get("best_accuracy", 0.0))
    start_epoch = int(checkpoint["epoch"]) + 1
    return start_epoch, best_state, best_accuracy


class StructuredSudokuTransformer(nn.Module):
    def __init__(
        self,
        num_labels: int,
        d_model: int = 72,
        n_heads: int = 6,
        n_layers: int = 3,
        d_ff: int = 192,
    ) -> None:
        super().__init__()
        self.model_kind = "structured-sudoku-transformer"
        self.board_embed = nn.Embedding(BOARD_VOCAB, d_model)
        self.focus_embed = nn.Embedding(FOCUS_VOCAB, d_model)
        self.binary_embed = nn.Embedding(BINARY_VOCAB, d_model)
        self.history_embed = nn.Embedding(HISTORY_VOCAB, d_model)
        self.count_embed = nn.Embedding(COUNT_VOCAB, d_model)
        self.depth_embed = nn.Embedding(DEPTH_VOCAB, d_model)

        self.sequence_length = 1 + BOARD_LENGTH + 1 + 1 + CANDIDATE_LENGTH + HISTORY_LENGTH + 1 + 1
        self.cls_token = nn.Parameter(torch.zeros(1, 1, d_model))
        self.position_embed = nn.Parameter(torch.zeros(1, self.sequence_length, d_model))

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_heads,
            dim_feedforward=d_ff,
            dropout=0.0,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=n_layers)
        self.norm = nn.LayerNorm(d_model)
        self.head = nn.Linear(d_model, num_labels)
        self._reset_parameters()

    def _reset_parameters(self) -> None:
        nn.init.normal_(self.cls_token, mean=0.0, std=0.02)
        nn.init.normal_(self.position_embed, mean=0.0, std=0.02)

    def forward(
        self,
        board_tokens: torch.Tensor,
        focus_row: torch.Tensor,
        focus_col: torch.Tensor,
        candidate_mask: torch.Tensor,
        history_ops: torch.Tensor,
        filled_count: torch.Tensor,
        search_depth: torch.Tensor,
    ) -> torch.Tensor:
        if board_tokens.dtype != torch.long:
            board_tokens = board_tokens.long()
        if focus_row.dtype != torch.long:
            focus_row = focus_row.long()
        if focus_col.dtype != torch.long:
            focus_col = focus_col.long()
        if candidate_mask.dtype != torch.long:
            candidate_mask = candidate_mask.long()
        if history_ops.dtype != torch.long:
            history_ops = history_ops.long()
        if filled_count.dtype != torch.long:
            filled_count = filled_count.long()
        if search_depth.dtype != torch.long:
            search_depth = search_depth.long()

        board_tokens = board_tokens.clamp_(0, BOARD_VOCAB - 1)
        focus_row = focus_row.clamp_(0, FOCUS_VOCAB - 1)
        focus_col = focus_col.clamp_(0, FOCUS_VOCAB - 1)
        candidate_mask = candidate_mask.clamp_(0, BINARY_VOCAB - 1)
        history_ops = history_ops.clamp_(0, HISTORY_VOCAB - 1)
        filled_count = filled_count.clamp_(0, COUNT_VOCAB - 1)
        search_depth = search_depth.clamp_(0, DEPTH_VOCAB - 1)

        sequence = [
            self.cls_token.expand(board_tokens.shape[0], -1, -1),
            self.board_embed(board_tokens),
            self.focus_embed(focus_row).unsqueeze(1),
            self.focus_embed(focus_col).unsqueeze(1),
            self.binary_embed(candidate_mask),
            self.history_embed(history_ops),
            self.count_embed(filled_count).unsqueeze(1),
            self.depth_embed(search_depth).unsqueeze(1),
        ]
        x = torch.cat(sequence, dim=1)
        x = x + self.position_embed[:, : x.shape[1]]
        x = self.encoder(x)
        pooled = self.norm(x[:, 0])
        return self.head(pooled)


class SudokuGraphLayer(nn.Module):
    def __init__(self, d_model: int) -> None:
        super().__init__()
        self.self_proj = nn.Linear(d_model, d_model)
        self.neighbor_proj = nn.Linear(d_model, d_model)
        self.context_proj = nn.Linear(d_model, d_model)
        self.output_proj = nn.Linear(d_model, d_model)
        self.norm = nn.LayerNorm(d_model)

    def forward(
        self,
        node_states: torch.Tensor,
        graph_context: torch.Tensor,
        adjacency: torch.Tensor,
    ) -> torch.Tensor:
        neighbors = torch.matmul(adjacency, node_states)
        updates = (
            self.self_proj(node_states)
            + self.neighbor_proj(neighbors)
            + self.context_proj(graph_context).unsqueeze(1)
        )
        updates = self.output_proj(F.gelu(updates))
        return self.norm(node_states + updates)


class StructuredSudokuGNN(nn.Module):
    def __init__(
        self,
        num_labels: int,
        d_model: int = 96,
        n_layers: int = 6,
        d_readout: int = 192,
    ) -> None:
        super().__init__()
        self.model_kind = "structured-sudoku-gnn"
        self.sequence_length = BOARD_LENGTH

        self.board_embed = nn.Embedding(BOARD_VOCAB, d_model)
        self.row_embed = nn.Embedding(BOARD_SIDE, d_model)
        self.col_embed = nn.Embedding(BOARD_SIDE, d_model)
        self.box_embed = nn.Embedding(BOARD_SIDE, d_model)
        self.focus_flag_embed = nn.Embedding(BINARY_VOCAB, d_model)

        self.focus_embed = nn.Embedding(FOCUS_VOCAB, d_model)
        self.binary_embed = nn.Embedding(BINARY_VOCAB, d_model)
        self.history_embed = nn.Embedding(HISTORY_VOCAB, d_model)
        self.count_embed = nn.Embedding(COUNT_VOCAB, d_model)
        self.depth_embed = nn.Embedding(DEPTH_VOCAB, d_model)

        self.candidate_proj = nn.Linear(CANDIDATE_LENGTH * d_model, d_model)
        self.history_proj = nn.Linear(HISTORY_LENGTH * d_model, d_model)
        self.context_proj = nn.Linear(d_model * 6, d_model)
        self.layers = nn.ModuleList(SudokuGraphLayer(d_model) for _ in range(n_layers))
        self.readout = nn.Sequential(
            nn.Linear(d_model * 3, d_readout),
            nn.GELU(),
            nn.LayerNorm(d_readout),
            nn.Linear(d_readout, num_labels),
        )

        self.register_buffer("row_ids", SUDOKU_ROW_IDS.clone(), persistent=False)
        self.register_buffer("col_ids", SUDOKU_COL_IDS.clone(), persistent=False)
        self.register_buffer("box_ids", SUDOKU_BOX_IDS.clone(), persistent=False)
        self.register_buffer("adjacency", SUDOKU_ADJACENCY.clone(), persistent=False)
        self.register_buffer("node_indices", SUDOKU_NODE_INDICES.clone(), persistent=False)

    def forward(
        self,
        board_tokens: torch.Tensor,
        focus_row: torch.Tensor,
        focus_col: torch.Tensor,
        candidate_mask: torch.Tensor,
        history_ops: torch.Tensor,
        filled_count: torch.Tensor,
        search_depth: torch.Tensor,
    ) -> torch.Tensor:
        if board_tokens.dtype != torch.long:
            board_tokens = board_tokens.long()
        if focus_row.dtype != torch.long:
            focus_row = focus_row.long()
        if focus_col.dtype != torch.long:
            focus_col = focus_col.long()
        if candidate_mask.dtype != torch.long:
            candidate_mask = candidate_mask.long()
        if history_ops.dtype != torch.long:
            history_ops = history_ops.long()
        if filled_count.dtype != torch.long:
            filled_count = filled_count.long()
        if search_depth.dtype != torch.long:
            search_depth = search_depth.long()

        board_tokens = board_tokens.clamp_(0, BOARD_VOCAB - 1)
        focus_row = focus_row.clamp_(0, FOCUS_VOCAB - 1)
        focus_col = focus_col.clamp_(0, FOCUS_VOCAB - 1)
        candidate_mask = candidate_mask.clamp_(0, BINARY_VOCAB - 1)
        history_ops = history_ops.clamp_(0, HISTORY_VOCAB - 1)
        filled_count = filled_count.clamp_(0, COUNT_VOCAB - 1)
        search_depth = search_depth.clamp_(0, DEPTH_VOCAB - 1)

        focus_row_index = (focus_row - 1).clamp(min=0, max=BOARD_SIDE - 1)
        focus_col_index = (focus_col - 1).clamp(min=0, max=BOARD_SIDE - 1)
        focus_valid = ((focus_row > 0) & (focus_col > 0)).long()
        focus_index = focus_row_index * BOARD_SIDE + focus_col_index
        focus_flags = (self.node_indices.unsqueeze(0) == focus_index.unsqueeze(1)).long()
        focus_flags = focus_flags * focus_valid.unsqueeze(1)

        node_states = (
            self.board_embed(board_tokens)
            + self.row_embed(self.row_ids).unsqueeze(0)
            + self.col_embed(self.col_ids).unsqueeze(0)
            + self.box_embed(self.box_ids).unsqueeze(0)
            + self.focus_flag_embed(focus_flags)
        )

        candidate_context = self.candidate_proj(self.binary_embed(candidate_mask).flatten(1))
        history_context = self.history_proj(self.history_embed(history_ops).flatten(1))
        graph_context = self.context_proj(
            torch.cat(
                [
                    self.focus_embed(focus_row),
                    self.focus_embed(focus_col),
                    candidate_context,
                    history_context,
                    self.count_embed(filled_count),
                    self.depth_embed(search_depth),
                ],
                dim=-1,
            )
        )
        graph_context = F.gelu(graph_context)

        for layer in self.layers:
            node_states = layer(node_states, graph_context, self.adjacency)

        gather_index = focus_index.view(-1, 1, 1).expand(-1, 1, node_states.shape[-1])
        focus_state = torch.gather(node_states, 1, gather_index).squeeze(1)
        focus_state = focus_state * focus_valid.unsqueeze(-1)
        global_state = node_states.mean(dim=1)

        return self.readout(torch.cat([focus_state, global_state, graph_context], dim=-1))


def build_structured_model(num_labels: int, arch: str = "transformer") -> nn.Module:
    if arch == "transformer":
        return StructuredSudokuTransformer(num_labels=num_labels)
    if arch == "gnn":
        return StructuredSudokuGNN(num_labels=num_labels)
    raise ValueError(
        f"Unsupported architecture {arch!r}. Expected one of: {', '.join(SUPPORTED_MODEL_ARCHITECTURES)}."
    )


def evaluate(
    model: nn.Module,
    dataloader: DataLoader,
    device: torch.device,
    *,
    log_every: int = 0,
    sample_count: int | None = None,
    batch_size: int | None = None,
    split_name: str = "eval",
) -> tuple[float, float]:
    model.eval()
    total = 0
    correct = 0
    total_loss = 0.0
    criterion = nn.CrossEntropyLoss()
    started_at = time.perf_counter()
    estimated_batches = _estimated_batches(sample_count, batch_size)

    with torch.no_grad():
        for step, batch in enumerate(dataloader, start=1):
            board_tokens, focus_row, focus_col, candidate_mask, history_ops, filled_count, search_depth, labels = (
                tensor.to(device) for tensor in batch
            )
            logits = model(
                board_tokens,
                focus_row,
                focus_col,
                candidate_mask,
                history_ops,
                filled_count,
                search_depth,
            )
            loss = criterion(logits, labels)
            predictions = logits.argmax(dim=-1)
            correct += (predictions == labels).sum().item()
            total += labels.size(0)
            total_loss += loss.item() * labels.size(0)

            if log_every > 0 and step % log_every == 0:
                elapsed = max(time.perf_counter() - started_at, 1e-6)
                avg_loss = total_loss / total
                accuracy = correct / total
                print(
                    f"{split_name} batch={_format_progress(step, estimated_batches)} "
                    f"samples={_format_progress(total, sample_count)} "
                    f"avg_loss={avg_loss:.4f} accuracy={accuracy:.4f} "
                    f"samples_per_s={total / elapsed:.1f} elapsed={elapsed:.1f}s",
                    flush=True,
                )

    return correct / total, total_loss / total


def train_model(
    model: nn.Module,
    train_loader: DataLoader,
    eval_loader: DataLoader,
    device: torch.device,
    epochs: int,
    learning_rate: float,
    target_accuracy: float,
    *,
    log_every: int = 0,
    train_count: int | None = None,
    eval_count: int | None = None,
    batch_size: int | None = None,
    checkpoint_dir: Path | None = None,
    checkpoint_every: int = 1,
    resume_from_checkpoint: Path | None = None,
) -> tuple[nn.Module, dict[str, float]]:
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=0.0)
    criterion = nn.CrossEntropyLoss()
    best_accuracy = 0.0
    best_state = None
    last_train_loss = 0.0
    start_epoch = 1

    model.to(device)

    if resume_from_checkpoint is not None:
        if not resume_from_checkpoint.exists():
            raise FileNotFoundError(f"Resume checkpoint not found: {resume_from_checkpoint}")
        start_epoch, best_state, best_accuracy = load_training_checkpoint(
            resume_from_checkpoint,
            model=model,
            optimizer=optimizer,
            device=device,
        )
        print(
            f"resuming from {resume_from_checkpoint} at epoch={start_epoch:02d} "
            f"best_accuracy={best_accuracy:.4f}",
            flush=True,
        )
        if start_epoch > epochs:
            raise RuntimeError(
                f"Resume checkpoint is already at epoch {start_epoch - 1}, "
                f"which is past requested epochs={epochs}."
            )

    for epoch in range(start_epoch, epochs + 1):
        model.train()
        running_loss = 0.0
        sample_count = 0
        epoch_started_at = time.perf_counter()
        estimated_batches = _estimated_batches(train_count, batch_size)

        print(
            f"epoch={epoch:02d} start train_samples={train_count or '?'} "
            f"eval_samples={eval_count or '?'} batch_size={batch_size or '?'} "
            f"log_every={log_every or 'epoch-only'}",
            flush=True,
        )

        for step, batch in enumerate(train_loader, start=1):
            board_tokens, focus_row, focus_col, candidate_mask, history_ops, filled_count, search_depth, labels = (
                tensor.to(device) for tensor in batch
            )
            logits = model(
                board_tokens,
                focus_row,
                focus_col,
                candidate_mask,
                history_ops,
                filled_count,
                search_depth,
            )
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)

            current_batch_size = labels.size(0)
            running_loss += loss.item() * current_batch_size
            sample_count += current_batch_size

            if log_every > 0 and step % log_every == 0:
                elapsed = max(time.perf_counter() - epoch_started_at, 1e-6)
                avg_loss = running_loss / sample_count
                print(
                    f"epoch={epoch:02d} train batch={_format_progress(step, estimated_batches)} "
                    f"samples={_format_progress(sample_count, train_count)} "
                    f"avg_loss={avg_loss:.4f} samples_per_s={sample_count / elapsed:.1f} "
                    f"elapsed={elapsed:.1f}s",
                    flush=True,
                )

        last_train_loss = running_loss / sample_count
        accuracy, eval_loss = evaluate(
            model,
            eval_loader,
            device,
            log_every=log_every,
            sample_count=eval_count,
            batch_size=batch_size,
            split_name=f"epoch={epoch:02d} eval",
        )
        epoch_elapsed = time.perf_counter() - epoch_started_at
        print(
            f"epoch={epoch:02d} train_loss={last_train_loss:.4f} "
            f"eval_loss={eval_loss:.4f} accuracy={accuracy:.4f} "
            f"elapsed={epoch_elapsed:.1f}s",
            flush=True,
        )

        if accuracy >= best_accuracy:
            best_accuracy = accuracy
            best_state = _clone_state_dict_to_cpu(model)
            print(f"epoch={epoch:02d} new_best_accuracy={best_accuracy:.4f}", flush=True)
            if checkpoint_dir is not None:
                best_checkpoint = checkpoint_dir / "best.pt"
                _save_training_checkpoint(
                    best_checkpoint,
                    epoch=epoch,
                    model=model,
                    optimizer=optimizer,
                    best_state=best_state,
                    best_accuracy=best_accuracy,
                    train_loss=last_train_loss,
                    eval_loss=eval_loss,
                )
                print(f"epoch={epoch:02d} saved checkpoint {best_checkpoint}", flush=True)

        if checkpoint_dir is not None and checkpoint_every > 0 and epoch % checkpoint_every == 0:
            latest_checkpoint = checkpoint_dir / "latest.pt"
            _save_training_checkpoint(
                latest_checkpoint,
                epoch=epoch,
                model=model,
                optimizer=optimizer,
                best_state=best_state,
                best_accuracy=best_accuracy,
                train_loss=last_train_loss,
                eval_loss=eval_loss,
            )
            print(f"epoch={epoch:02d} saved checkpoint {latest_checkpoint}", flush=True)

        if target_accuracy > 0.0 and accuracy >= target_accuracy:
            print(
                f"epoch={epoch:02d} reached target_accuracy={target_accuracy:.4f}; stopping early",
                flush=True,
            )
            break

    if best_state is None:
        raise RuntimeError("Training did not produce a checkpoint.")

    model.load_state_dict(best_state)
    return model, {
        "accuracy": best_accuracy,
        "train_loss": last_train_loss,
    }


def export_model(
    model: nn.Module,
    raw_dir: Path,
    export_dir: Path,
    metrics: dict[str, float],
    metadata: dict,
    label_names: list[str],
    train_count: int,
    eval_count: int,
) -> None:
    if raw_dir.exists():
        shutil.rmtree(raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), raw_dir / "model.pt")

    export_metadata = {
        **metadata,
        "trainCount": train_count,
        "evalCount": eval_count,
        **metrics,
        "labels": label_names,
        "inputNames": INPUT_NAMES,
        "modelKind": getattr(model, "model_kind", model.__class__.__name__),
    }
    sequence_length = getattr(model, "sequence_length", None)
    if sequence_length is not None:
        export_metadata["sequenceLength"] = sequence_length
    (raw_dir / "metadata.json").write_text(json.dumps(export_metadata, indent=2))

    if export_dir.exists():
        shutil.rmtree(export_dir)
    export_dir.mkdir(parents=True, exist_ok=True)
    onnx_dir = export_dir / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)

    example_inputs = (
        torch.zeros((1, BOARD_LENGTH), dtype=torch.int32),
        torch.zeros((1,), dtype=torch.int32),
        torch.zeros((1,), dtype=torch.int32),
        torch.zeros((1, CANDIDATE_LENGTH), dtype=torch.int32),
        torch.zeros((1, HISTORY_LENGTH), dtype=torch.int32),
        torch.zeros((1,), dtype=torch.int32),
        torch.zeros((1,), dtype=torch.int32),
    )

    model.eval()
    model.cpu()
    model_path = onnx_dir / "model.onnx"
    torch.onnx.export(
        model,
        example_inputs,
        model_path,
        input_names=INPUT_NAMES,
        output_names=["logits"],
        dynamic_axes={name: {0: "batch"} for name in INPUT_NAMES} | {"logits": {0: "batch"}},
        opset_version=17,
        external_data=False,
    )
    shutil.copy2(model_path, onnx_dir / "model_quantized.onnx")
    (export_dir / "metadata.json").write_text(json.dumps(export_metadata, indent=2))


def default_device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")
