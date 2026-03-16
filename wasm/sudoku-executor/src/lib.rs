use std::cell::RefCell;
use std::slice;

thread_local! {
    static RESULT: RefCell<Vec<u8>> = RefCell::new(Vec::new());
}

#[derive(Clone)]
struct Event {
    kind: &'static str,
    row: usize,
    col: usize,
    value: Option<u8>,
    candidates: Vec<u8>,
    depth: usize,
}

#[derive(Default)]
struct Stats {
    placements: usize,
    backtracks: usize,
    focuses: usize,
}

struct SolveOutput {
    solved: bool,
    solution: [u8; 81],
    trace: Vec<Event>,
    stats: Stats,
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = vec![0; len];
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }

    unsafe {
        drop(Vec::from_raw_parts(ptr, len, len));
    }
}

#[no_mangle]
pub extern "C" fn result_ptr() -> *const u8 {
    RESULT.with(|result| result.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn result_len() -> usize {
    RESULT.with(|result| result.borrow().len())
}

#[no_mangle]
pub extern "C" fn solve(ptr: *const u8, len: usize) -> i32 {
    let bytes = unsafe { slice::from_raw_parts(ptr, len) };

    let payload = match std::str::from_utf8(bytes) {
        Ok(text) => match solve_puzzle(text) {
            Ok(result) => {
                let status = if result.solved { 1 } else { 0 };
                (result_to_json(&result), status)
            }
            Err(message) => (error_json(message), 0),
        },
        Err(_) => (error_json("input was not valid utf-8"), 0),
    };

    RESULT.with(|result| {
        *result.borrow_mut() = payload.0.into_bytes();
    });

    payload.1
}

fn solve_puzzle(input: &str) -> Result<SolveOutput, &'static str> {
    let filtered: Vec<u8> = input
        .bytes()
        .filter(|byte| byte.is_ascii_digit() || *byte == b'.')
        .collect();

    if filtered.len() != 81 {
        return Err("sudoku input must contain exactly 81 cells");
    }

    let mut board = [0_u8; 81];
    for (index, byte) in filtered.into_iter().enumerate() {
        board[index] = match byte {
            b'0' | b'.' => 0,
            b'1'..=b'9' => byte - b'0',
            _ => return Err("sudoku input contained an unsupported token"),
        };
    }

    if !is_consistent(&board) {
        return Err("sudoku input contains contradictions");
    }

    let mut trace = Vec::new();
    let mut stats = Stats::default();
    let solved = search(&mut board, &mut trace, &mut stats, 0);

    Ok(SolveOutput {
        solved,
        solution: board,
        trace,
        stats,
    })
}

fn search(board: &mut [u8; 81], trace: &mut Vec<Event>, stats: &mut Stats, depth: usize) -> bool {
    let Some((index, candidates)) = choose_next_cell(board) else {
        return true;
    };

    if candidates.is_empty() {
        return false;
    }

    stats.focuses += 1;
    trace.push(Event {
        kind: "focus",
        row: index / 9,
        col: index % 9,
        value: None,
        candidates: candidates.clone(),
        depth,
    });

    for candidate in candidates {
        board[index] = candidate;
        stats.placements += 1;
        trace.push(Event {
            kind: "place",
            row: index / 9,
            col: index % 9,
            value: Some(candidate),
            candidates: Vec::new(),
            depth,
        });

        if search(board, trace, stats, depth + 1) {
            return true;
        }

        board[index] = 0;
        stats.backtracks += 1;
        trace.push(Event {
            kind: "backtrack",
            row: index / 9,
            col: index % 9,
            value: Some(candidate),
            candidates: Vec::new(),
            depth,
        });
    }

    false
}

fn choose_next_cell(board: &[u8; 81]) -> Option<(usize, Vec<u8>)> {
    let mut best: Option<(usize, Vec<u8>)> = None;

    for index in 0..81 {
        if board[index] != 0 {
            continue;
        }

        let candidates = get_candidates(board, index);
        match &best {
            None => best = Some((index, candidates)),
            Some((_, current)) if candidates.len() < current.len() => {
                best = Some((index, candidates))
            }
            _ => {}
        }

        if let Some((_, current)) = &best {
            if current.len() == 1 {
                return best;
            }
        }
    }

    best
}

fn get_candidates(board: &[u8; 81], index: usize) -> Vec<u8> {
    if board[index] != 0 {
        return Vec::new();
    }

    let row = index / 9;
    let col = index % 9;
    let mut blocked = [false; 10];

    for scan in 0..9 {
        let row_value = board[row * 9 + scan];
        let col_value = board[scan * 9 + col];
        if row_value != 0 {
            blocked[row_value as usize] = true;
        }
        if col_value != 0 {
            blocked[col_value as usize] = true;
        }
    }

    let box_row = (row / 3) * 3;
    let box_col = (col / 3) * 3;
    for r in box_row..box_row + 3 {
        for c in box_col..box_col + 3 {
            let value = board[r * 9 + c];
            if value != 0 {
                blocked[value as usize] = true;
            }
        }
    }

    let mut candidates = Vec::new();
    for value in 1..=9 {
        if !blocked[value as usize] {
            candidates.push(value);
        }
    }
    candidates
}

fn is_consistent(board: &[u8; 81]) -> bool {
    for row in 0..9 {
        if !unit_is_consistent((0..9).map(|col| board[row * 9 + col])) {
            return false;
        }
    }

    for col in 0..9 {
        if !unit_is_consistent((0..9).map(|row| board[row * 9 + col])) {
            return false;
        }
    }

    for box_row in 0..3 {
        for box_col in 0..3 {
            let values = (0..3).flat_map(|r| {
                (0..3).map(move |c| board[(box_row * 3 + r) * 9 + box_col * 3 + c])
            });
            if !unit_is_consistent(values) {
                return false;
            }
        }
    }

    true
}

fn unit_is_consistent(values: impl Iterator<Item = u8>) -> bool {
    let mut seen = [false; 10];
    for value in values {
        if value == 0 {
            continue;
        }
        if seen[value as usize] {
            return false;
        }
        seen[value as usize] = true;
    }
    true
}

fn error_json(message: &str) -> String {
    format!(r#"{{"error":"{}"}}"#, message)
}

fn result_to_json(result: &SolveOutput) -> String {
    let mut json = String::new();
    json.push_str(r#"{"solved":"#);
    json.push_str(if result.solved { "true" } else { "false" });
    json.push_str(r#","solution":""#);
    for value in result.solution {
        json.push(char::from(b'0' + value));
    }
    json.push('"');
    json.push_str(r#","trace":["#);

    for (index, event) in result.trace.iter().enumerate() {
        if index > 0 {
            json.push(',');
        }
        push_event_json(&mut json, event);
    }

    json.push_str(r#"],"stats":{"placements":"#);
    json.push_str(&result.stats.placements.to_string());
    json.push_str(r#","backtracks":"#);
    json.push_str(&result.stats.backtracks.to_string());
    json.push_str(r#","focuses":"#);
    json.push_str(&result.stats.focuses.to_string());
    json.push_str("}}");
    json
}

fn push_event_json(json: &mut String, event: &Event) {
    json.push_str(r#"{"type":""#);
    json.push_str(event.kind);
    json.push('"');
    json.push_str(r#","row":"#);
    json.push_str(&event.row.to_string());
    json.push_str(r#","col":"#);
    json.push_str(&event.col.to_string());
    json.push_str(r#","depth":"#);
    json.push_str(&event.depth.to_string());

    if let Some(value) = event.value {
        json.push_str(r#","value":"#);
        json.push_str(&value.to_string());
    }

    if !event.candidates.is_empty() {
        json.push_str(r#","candidates":["#);
        for (index, candidate) in event.candidates.iter().enumerate() {
            if index > 0 {
                json.push(',');
            }
            json.push_str(&candidate.to_string());
        }
        json.push(']');
    }

    json.push('}');
}
