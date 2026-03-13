import * as board_util from './board.mjs';
import * as utils from './utils.mjs';

(function() {

var board;
var clicked_loc = null;
var legal_moves = null;
var moves = []; // list of [move, piece_type] — the main line
var move_index = null;
var board_key_to_eval = {};
const player_id_to_color = {0: 'red', 1: 'blue', 2: 'yellow', 3: 'green'};
const colors = ['red', 'blue', 'yellow', 'green'];
var request_interval = null;
var max_search_depth = null;
var secs_per_move = null;
var MATE_VALUE = 1000000;
var auto_play_enabled = false;
var auto_play_interval = null;

// Board rotation: 0=red at bottom, 1=blue, 2=yellow, 3=green
var board_rotation = 0;
const rotation_order = ['red', 'blue', 'yellow', 'green'];

// Player names and ELOs from PGN
var player_names = {red: null, blue: null, yellow: null, green: null};
var player_elos = {red: null, blue: null, yellow: null, green: null};

// Game info from PGN headers
var game_info = {time_control: null, variant: null, rule_variants: null};

// Move annotations: '+' for check, '#' for checkmate, '' otherwise
var move_annotations = [];

// Player eliminations: {color: move_index} — pieces turn grey after this index
var eliminations = {};

// User-drawn arrows and square highlights
var user_arrows = [];        // [{from_row, from_col, to_row, to_col, color}]
var user_highlights = [];    // [{row, col, color}]
var arrow_drag_state = null; // {from_row, from_col, startX, startY, color}
var user_arrow_colors = {red: '#e87272', blue: '#6bb5f0', yellow: '#d4c94a', green: '#6abf7b'};

// Variation support
var branches = {};        // {move_index: [[[move, piece_type], ...]]}
var active_branch = null; // null or {from: N, idx: I, pos: P}

if (window.localStorage != null) {
  var max_depth = parseInt(window.localStorage['max_search_depth']);
  if (max_depth != null && !isNaN(max_depth)) {
    max_search_depth = max_depth;
  }
  var secs = parseInt(window.localStorage['secs_per_move']);
  if (secs != null && !isNaN(secs)) {
    secs_per_move = secs;
  }
}

function createBoard() {
  var rows = []
  var row_labels = [14,13,12,11,10,9,8,7,6,5,4,3,2,1];
  var col_labels = 'abcdefghijklmn';

  // Row numbers: leftmost playable square per row
  var row_coord_cells = {};
  for (var r = 0; r < 14; r++) {
    var c = (r < 3 || r > 10) ? 3 : 0;
    row_coord_cells[`${r}_${c}`] = String(row_labels[r]);
  }

  // Column letters: bottommost playable square per column
  var col_coord_cells = {};
  for (var c = 0; c < 14; c++) {
    var r = (c < 3 || c > 10) ? 10 : 13;
    col_coord_cells[`${r}_${c}`] = col_labels[c];
  }

  for (var row = 0; row < 14; row++) {
    var cols = []
    for (var col = 0; col < 14; col++) {
      var classes = ['cell'];
      if ((row < 3 && col < 3)
          || (row > 10 && col < 3)
          || (row > 10 && col > 10)
          || (row < 3 && col > 10)) {
        classes.push('blocked');
      } else if ((row + col) % 2 == 0) {
        classes.push('even');
      } else {
        classes.push('odd');
      }

      var class_str = classes.join(' ');
      var cell_id = `cell_${row}_${col}`;
      var coord_html = '';
      var key = `${row}_${col}`;
      if (row_coord_cells[key]) {
        coord_html += `<span class='coord coord-row'>${row_coord_cells[key]}</span>`;
      }
      if (col_coord_cells[key]) {
        coord_html += `<span class='coord coord-col'>${col_coord_cells[key]}</span>`;
      }
      var cell = `<div class='${class_str}'
                       id='${cell_id}'
                       data-row='${row}'
                       data-col='${col}'>${coord_html}</div>`;
      cols.push(cell);
    }
    var cols_html = cols.join('');
    var row_html = `<div class='row'>${cols_html}</div>`;
    rows.push(row_html);
  }

  rows = rows.join('\n');
  var board_html = `<div class='board-wrapper'>${rows}</div>`;

  $('#board').html(board_html);

  // Create move overlay
  var svg_html = `
    <svg id="move_svg" width="100%" height="100%"
         xmlns="http://www.w3.org/2000/svg">
    </svg>`;

  $('#move_overlay').html(svg_html);
}

createBoard();

// --- Persist/restore state across refreshes ---
function saveState() {
  try {
    var pgn_str = $('#pgn_input').val();
    if (pgn_str) {
      window.localStorage['saved_pgn'] = pgn_str;
    }
    // Save current position
    var pos = move_index != null ? move_index : -1;
    window.localStorage['saved_move_index'] = pos;
    window.localStorage['saved_rotation'] = board_rotation;
  } catch(e) {}
}

function restoreState() {
  try {
    var saved_pgn = window.localStorage['saved_pgn'];
    if (saved_pgn) {
      $('#pgn_input').val(saved_pgn);
      var res = utils.parseGameFromPGN(saved_pgn);
      var moves_and_piece_types = [];
      for (var i = 0; i < res['moves'].length; i++) {
        moves_and_piece_types.push([res['moves'][i], res['piece_types'][i]]);
      }
      resetBoard(res['board'], moves_and_piece_types, res['player_names'], res['player_elos'], res['game_info'], res['eliminations']);

      // Restore move position
      var saved_idx = parseInt(window.localStorage['saved_move_index']);
      if (!isNaN(saved_idx) && saved_idx >= -1 && saved_idx < moves.length) {
        jumpToMainLine(saved_idx);
      }

      // Restore rotation
      var saved_rot = parseInt(window.localStorage['saved_rotation']);
      if (!isNaN(saved_rot) && saved_rot >= 0 && saved_rot <= 3) {
        board_rotation = saved_rot;
      }
      return true;
    }
  } catch(e) {}
  return false;
}

$(document).ready(function() {
  var restored = restoreState();
  if (!restored) {
    resetBoard();
  }
  applyRotation();
  displayBoard();
  request_interval = setInterval(requestBoardEvaluation, 50);
  if (max_search_depth != null) {
    $('#max_depth').val(max_search_depth);
  }
  $('#max_depth').change(function() {
    var max_depth = parseInt($(this).val());
    if (max_depth == null || isNaN(max_depth) || max_depth < 0) {
      max_search_depth = null;
    } else {
      max_search_depth = max_depth;
    }
    window.localStorage['max_search_depth'] = max_search_depth;
  });

  if (secs_per_move != null) {
    $('#secs_per_move').val(secs_per_move);
  }
  $('#secs_per_move').change(function() {
    var secs = parseInt($(this).val());
    if (secs == null || isNaN(secs) || secs < 0) {
      secs_per_move = null;
    } else {
      secs_per_move = secs;
    }
    window.localStorage['secs_per_move'] = secs_per_move;
  });
  function loadPGN() {
    $('#pgn_error').text('');
    var pgn_str = $('#pgn_input').val();
    if (pgn_str != '') {
      var pgn_board = null;
      var pgn_moves = null;
      var piece_types = null;
      try {
        var res = utils.parseGameFromPGN(pgn_str);
        pgn_board = res['board'];
        pgn_moves = res['moves'];
        piece_types = res['piece_types'];
      } catch (error) {
        $('#pgn_error').text(error.toString());
      }
      if (pgn_board != null) {
        var moves_and_piece_types = [];
        for (var i = 0; i < pgn_moves.length; i++) {
          moves_and_piece_types.push([pgn_moves.at(i), piece_types.at(i)]);
        }
        resetBoard(pgn_board, moves_and_piece_types, res['player_names'], res['player_elos'], res['game_info'], res['eliminations']);
        displayBoard();
        $('#pgn_error').text(`Loaded ${pgn_moves.length} moves successfully.`);
        $('#pgn_error').css('color', 'green');
        // Persist to localStorage
        saveState();
      }
    }
  }
  $('#pgn_input').on('input', loadPGN);
  $('#pgn_input').change(loadPGN);
  $('#new_game').click(function() {
    $('#pgn_input').val('');
    $('#pgn_error').text('');
    resetBoard();
    displayBoard();
    try { delete window.localStorage['saved_pgn']; } catch(e) {}
    saveState();
  });
  // --- Saved games ---
  $('#open_games_btn').click(function() {
    var list = $('#saved_games_list');
    if (list.hasClass('visible')) {
      list.removeClass('visible');
    } else {
      refreshSavedGamesList();
      list.addClass('visible');
    }
  });

  $('#save_game_btn').click(function() {
    var pgn = $('#pgn_input').val();
    if (!pgn) {
      $('#pgn_error').text('No game to save.');
      return;
    }
    $('#save_game_name').val(generateGameName());
    $('#save_game_form').addClass('visible');
    $('#save_game_name').focus().select();
  });

  $('#save_game_confirm').click(function() {
    var name = $('#save_game_name').val().trim() || generateGameName();
    saveCurrentGame(name);
    $('#save_game_form').removeClass('visible');
  });

  $('#save_game_cancel').click(function() {
    $('#save_game_form').removeClass('visible');
  });

  $('#save_game_name').on('keydown', function(e) {
    if (e.key === 'Enter') { $('#save_game_confirm').click(); }
    if (e.key === 'Escape') { $('#save_game_cancel').click(); }
  });

  $('#saved_games_list').on('click', '.saved-game-name', function(e) {
    var id = $(this).closest('.saved-game-row').data('id');
    loadSavedGame(id);
  });

  $('#saved_games_list').on('click', '.saved-game-delete', function(e) {
    e.stopPropagation();
    var id = $(this).closest('.saved-game-row').data('id');
    deleteSavedGame(id);
  });

  // --- User-drawn arrows and highlights ---
  $('#board').on('contextmenu', function(e) {
    e.preventDefault();
  });

  $('#board').on('mousedown', '.cell', function(e) {
    if (e.button !== 2) return; // only right-click
    var row = $(this).data('row');
    var col = $(this).data('col');
    if (row == null || col == null) return;
    // Ignore blocked (corner) cells
    if ($(this).hasClass('blocked')) return;
    var color = 'yellow'; // default
    if (e.altKey) color = 'blue';
    else if (e.shiftKey) color = 'green';
    else if (e.ctrlKey) color = 'red';
    arrow_drag_state = {from_row: row, from_col: col, startX: e.pageX, startY: e.pageY, color: color};
  });

  $(document).on('mouseup', function(e) {
    if (e.button !== 2 || arrow_drag_state == null) return;
    var ds = arrow_drag_state;
    arrow_drag_state = null;
    var target = getCellFromPoint(e.clientX, e.clientY);
    if (!target) return;
    if (target.row === ds.from_row && target.col === ds.from_col) {
      // Same cell — toggle square highlight
      var hlColor = ds.color;
      if (hlColor === 'yellow') hlColor = 'red'; // default highlight is red
      var existIdx = user_highlights.findIndex(function(h) {
        return h.row === target.row && h.col === target.col && h.color === hlColor;
      });
      if (existIdx >= 0) {
        user_highlights.splice(existIdx, 1);
      } else {
        // Remove any existing highlight on this cell first
        user_highlights = user_highlights.filter(function(h) {
          return !(h.row === target.row && h.col === target.col);
        });
        user_highlights.push({row: target.row, col: target.col, color: hlColor});
      }
    } else {
      // Different cell — toggle arrow
      var existIdx = user_arrows.findIndex(function(a) {
        return a.from_row === ds.from_row && a.from_col === ds.from_col
            && a.to_row === target.row && a.to_col === target.col && a.color === ds.color;
      });
      if (existIdx >= 0) {
        user_arrows.splice(existIdx, 1);
      } else {
        user_arrows.push({from_row: ds.from_row, from_col: ds.from_col,
                          to_row: target.row, to_col: target.col, color: ds.color});
      }
    }
    displayBoard();
  });
})

function resetBoard(set_board = null, set_moves = null, set_player_names = null, set_player_elos = null, set_game_info = null, set_eliminations = null) {
  if (set_board == null) {
    board = board_util.Board.CreateStandardSetup();
    moves = [];
    move_index = null;
  } else {
    board = set_board;
    moves = set_moves;
    move_index = set_moves.length - 1;
  }
  clicked_loc = null;
  legal_moves = null;
  branches = {};
  active_branch = null;
  if (set_player_names) {
    player_names = set_player_names;
  } else {
    player_names = {red: null, blue: null, yellow: null, green: null};
  }
  if (set_player_elos) {
    player_elos = set_player_elos;
  } else {
    player_elos = {red: null, blue: null, yellow: null, green: null};
  }
  if (set_game_info) {
    game_info = set_game_info;
  } else {
    game_info = {time_control: null, variant: null, rule_variants: null};
  }
  eliminations = set_eliminations || {};
  computeMoveAnnotations();
  updateGameTitle();
  updatePlayerNamesBar();
  updatePlayerLabels();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Navigation ---

function movesEqual(m1, m2) {
  return m1.getFrom().equals(m2.getFrom()) && m1.getTo().equals(m2.getTo());
}

function exitBranch() {
  if (active_branch == null) return;
  // Undo all branch moves
  for (var i = 0; i <= active_branch.pos; i++) {
    board.undoMove();
  }
  active_branch = null;
}

function jumpToMainLine(target_index) {
  exitBranch();
  if (move_index == null) move_index = -1;
  // Now on main line at move_index
  if (target_index < move_index) {
    for (var i = 0; i < move_index - target_index; i++) {
      board.undoMove();
    }
  } else if (target_index > move_index) {
    for (var i = move_index + 1; i <= target_index; i++) {
      board.makeMove(moves[i][0]);
    }
  }
  move_index = target_index;
  clicked_loc = null;
  legal_moves = null;
}

function jumpToBranch(bp, vi, target_pos) {
  // First get to branch point on main line
  jumpToMainLine(bp);
  // Apply branch moves up to target_pos
  var branch = branches[bp][vi];
  for (var i = 0; i <= target_pos; i++) {
    board.makeMove(branch[i][0]);
  }
  active_branch = {from: bp, idx: vi, pos: target_pos};
  clicked_loc = null;
  legal_moves = null;
}

function maybeUndoMove(jump = 1) {
  if (active_branch != null) {
    var num = Math.min(jump, active_branch.pos + 1);
    for (var i = 0; i < num; i++) {
      board.undoMove();
    }
    active_branch.pos -= num;
    if (active_branch.pos < 0) {
      active_branch = null;
    }
    clicked_loc = null;
    legal_moves = null;
    displayBoard();
    return;
  }
  if (moves.length && move_index >= 0) {
    var num = Math.min(jump, move_index + 1);
    jumpToMainLine(move_index - num);
    displayBoard();
  }
}

function maybeRedoMove(jump = 1) {
  if (active_branch != null) {
    var branch = branches[active_branch.from][active_branch.idx];
    var remaining = branch.length - 1 - active_branch.pos;
    var num = Math.min(jump, remaining);
    for (var i = 0; i < num; i++) {
      board.makeMove(branch[active_branch.pos + i + 1][0]);
    }
    active_branch.pos += num;
    clicked_loc = null;
    legal_moves = null;
    displayBoard();
    return;
  }
  if (moves.length && move_index < moves.length - 1) {
    var num = Math.min(jump, moves.length - move_index - 1);
    jumpToMainLine(move_index + num);
    displayBoard();
  }
}

// --- Move execution ---

function checkEndsGame(move) {
  if (move.getEndsGame() == null) {
    var capture = move.getStandardCapture();
    if ((capture != null && capture.getPieceType().equals(board_util.KING))
        || board.getAllLegalMoves().length == 0) {
      move.setEndsGame(true);
    } else {
      move.setEndsGame(false);
    }
  }
}

function performMove(move, piece_type) {
  if (active_branch != null) {
    // Currently in a branch — extend or advance within it
    var branch = branches[active_branch.from][active_branch.idx];
    if (active_branch.pos < branch.length - 1) {
      // Mid-branch: check if matches next branch move
      var next = branch[active_branch.pos + 1][0];
      if (movesEqual(next, move)) {
        board.makeMove(branch[active_branch.pos + 1][0]);
        active_branch.pos++;
        displayBoard();
        return;
      }
      // Different move mid-branch: truncate and extend
      branch.splice(active_branch.pos + 1);
    }
    board.makeMove(move);
    branch.push([move, piece_type]);
    active_branch.pos = branch.length - 1;
    checkEndsGame(move);
    displayBoard();
    return;
  }

  // On main line
  if (move_index < moves.length - 1) {
    // Mid-game: check if matches next main line move
    var next = moves[move_index + 1][0];
    if (movesEqual(next, move)) {
      board.makeMove(moves[move_index + 1][0]);
      move_index++;
      displayBoard();
      return;
    }

    // Different move — create or enter a branch
    var bp = move_index;
    if (!branches[bp]) branches[bp] = [];

    // Check if this move already exists in a branch at this point
    for (var bi = 0; bi < branches[bp].length; bi++) {
      var b = branches[bp][bi];
      if (b.length > 0 && movesEqual(b[0][0], move)) {
        // Enter existing branch
        board.makeMove(b[0][0]);
        active_branch = {from: bp, idx: bi, pos: 0};
        displayBoard();
        return;
      }
    }

    // New branch
    board.makeMove(move);
    branches[bp].push([[move, piece_type]]);
    active_branch = {from: bp, idx: branches[bp].length - 1, pos: 0};
    checkEndsGame(move);
    displayBoard();
    return;
  }

  // At end of main line — extend it
  board.makeMove(move);
  moves.push([move, piece_type]);
  move_index = moves.length - 1;
  checkEndsGame(move);
  // Annotate the new move
  if (move.getEndsGame() === true) {
    move_annotations.push('#');
  } else {
    var kings_in_check = getKingsInCheck();
    move_annotations.push(Object.keys(kings_in_check).length > 0 ? '+' : '');
  }
  displayBoard();
}

function maybeMakeSuggestedMove() {
  var board_key = getBoardKey();
  var eval_results = board_key_to_eval[board_key];
  if (eval_results != null && 'evaluation' in eval_results) {
    var turn = board.getTurn();
    var principal_variation = eval_results['principal_variation'];
    for (const key_id in principal_variation) {
      const pv = principal_variation[key_id];
      const color = player_id_to_color[pv['turn']];

      if (color != turn.getColor().name) {
        break;
      }

      const from = pv['from'];
      const to = pv['to'];
      const from_row = from['row'];
      const from_col = from['col'];
      const to_row = to['row'];
      const to_col = to['col'];

      var piece = board.getPieceRowCol(from_row, from_col);
      var from_loc = new board_util.BoardLocation(from_row, from_col);
      var piece_legal_moves = board.getLegalMoves(piece, from_loc);
      var to_loc = new board_util.BoardLocation(to_row, to_col);
      for (const m of piece_legal_moves) {
        if (m.getTo().equals(to_loc)) {
          performMove(m, piece.getPieceType());
          break;
        }
      }
    }
  }
}

// --- Drag and drop + click to move ---
var drag_state = null; // {from_loc, piece, piece_type, drag_moves, ghost, started}

function getCellFromPoint(x, y) {
  var el = document.elementFromPoint(x, y);
  if (!el) return null;
  var cell = el.closest('.cell');
  if (!cell) return null;
  var row = parseInt(cell.dataset.row);
  var col = parseInt(cell.dataset.col);
  if (isNaN(row) || isNaN(col)) return null;
  return {row: row, col: col, element: cell};
}

function tryPlayMoveToLoc(loc, from_legal_moves) {
  for (const move of from_legal_moves) {
    if (move.getTo().equals(loc)) {
      var piece_type = board.getPiece(move.getFrom()).getPieceType();
      performMove(move, piece_type);
      return true;
    }
  }
  return false;
}

$('#board').on('mousedown', '.cell', function(e) {
  if (e.button !== 0) return; // only handle left-click here
  e.preventDefault();
  // Clear user arrows and highlights on left-click
  if (user_arrows.length > 0 || user_highlights.length > 0) {
    user_arrows = [];
    user_highlights = [];
  }
  var row = $(this).data('row');
  var col = $(this).data('col');
  var loc = new board_util.BoardLocation(row, col);

  // If we already have legal moves shown (from a previous click), try to play
  if (legal_moves != null) {
    if (tryPlayMoveToLoc(loc, legal_moves)) {
      clicked_loc = null;
      legal_moves = null;
      displayBoard();
      return;
    }
    // Clicked somewhere else — clear selection
    clicked_loc = null;
    legal_moves = null;
  }

  // Check if there's a piece here belonging to the current player
  if (loc in board.location_to_piece) {
    var loc_piece = board.location_to_piece[loc];
    var [bloc, piece] = loc_piece;
    if (piece.getColor().equals(board.getTurn().getColor())) {
      var drag_moves = board.getLegalMoves(piece, bloc);
      if (drag_moves && drag_moves.length > 0) {
        // Show legal moves immediately
        legal_moves = drag_moves;
        clicked_loc = bloc;
        displayBoard();

        // Create ghost piece for dragging
        var color_name = piece.getPlayer().getColor().name.toLowerCase();
        var piece_name = piece.getPieceType().name.toLowerCase();
        var ghost = document.createElement('div');
        ghost.className = `drag-ghost ${color_name}-${piece_name}`;
        ghost.style.left = (e.pageX - 25) + 'px';
        ghost.style.top = (e.pageY - 25) + 'px';
        document.body.appendChild(ghost);

        drag_state = {
          from_loc: bloc,
          piece: piece,
          piece_type: piece.getPieceType(),
          drag_moves: drag_moves,
          ghost: ghost,
          started: false,
          startX: e.pageX,
          startY: e.pageY
        };

        // Hide original piece during drag
        $(`#cell_${bloc.getRow()}_${bloc.getCol()}`).addClass('drag-source');
      }
    }
  }

  displayBoard();
});

$(document).on('mousemove', function(e) {
  if (drag_state == null) return;
  // Check if we've moved enough to consider it a drag (not just a click)
  var dx = e.pageX - drag_state.startX;
  var dy = e.pageY - drag_state.startY;
  if (!drag_state.started && (dx*dx + dy*dy) > 16) {
    drag_state.started = true;
  }
  if (drag_state.started) {
    drag_state.ghost.style.left = (e.pageX - 25) + 'px';
    drag_state.ghost.style.top = (e.pageY - 25) + 'px';
    drag_state.ghost.style.display = 'block';
  }
});

$(document).on('mouseup', function(e) {
  if (drag_state == null) return;
  var ds = drag_state;
  drag_state = null;

  // Remove ghost
  if (ds.ghost && ds.ghost.parentNode) {
    ds.ghost.parentNode.removeChild(ds.ghost);
  }
  $('.drag-source').removeClass('drag-source');

  if (!ds.started) {
    // It was a click, not a drag — legal moves are already shown, wait for second click
    return;
  }

  // It was a drag — find the drop target
  var target = getCellFromPoint(e.clientX, e.clientY);
  if (target) {
    var to_loc = new board_util.BoardLocation(target.row, target.col);
    tryPlayMoveToLoc(to_loc, ds.drag_moves);
  }

  clicked_loc = null;
  legal_moves = null;
  displayBoard();
});

var piece_classes = [];
Object.keys(board_util.PlayerColor).forEach(function(player_color) {
  var color_name = player_color.toLowerCase();
  Object.keys(board_util.PieceType).forEach(function(piece_type) {
    var piece_name = piece_type.toLowerCase();
    var class_name = `${color_name}-${piece_name}`;
    piece_classes.push(class_name);
  });
});
var piece_classes_str = piece_classes.join(' ');

// --- Get the last move played by each player (up to current position) ---
function getLastMovePerPlayer() {
  var result = {red: null, blue: null, yellow: null, green: null};
  // Determine all moves up to current position
  var effective_moves = [];
  if (move_index != null && move_index >= 0) {
    for (var i = 0; i <= move_index; i++) {
      effective_moves.push(moves[i]);
    }
  }
  if (active_branch != null) {
    var branch = branches[active_branch.from][active_branch.idx];
    for (var i = 0; i <= active_branch.pos; i++) {
      effective_moves.push(branch[i]);
    }
  }
  // Walk backwards to find the last move for each color
  // Turn order: red(0), blue(1), yellow(2), green(3) repeating
  for (var i = effective_moves.length - 1; i >= 0; i--) {
    var color = colors[i % 4];
    if (result[color] == null) {
      result[color] = effective_moves[i][0];
    }
    // Stop early if we found all 4
    if (result.red && result.blue && result.yellow && result.green) break;
  }
  return result;
}

// --- Check detection ---

function getKingsInCheck() {
  var result = {};
  var players = [board_util.kRedPlayer, board_util.kBluePlayer,
                 board_util.kYellowPlayer, board_util.kGreenPlayer];
  for (var p of players) {
    var kingLoc = board.getKingLocation(p);
    if (kingLoc != null) {
      var team = p.getTeam();
      var otherTeam = team.equals(board_util.Team.RedYellow)
        ? board_util.Team.BlueGreen : board_util.Team.RedYellow;
      if (board.isAttackedByTeam(otherTeam, kingLoc)) {
        var color = p.getColor().name.toLowerCase();
        result[color] = kingLoc;
      }
    }
  }
  return result;
}

function computeMoveAnnotations() {
  move_annotations = [];
  if (moves.length === 0) return;
  var temp = board_util.Board.CreateStandardSetup();
  for (var i = 0; i < moves.length; i++) {
    var [mv, pt] = moves[i];
    temp.makeMove(mv);
    // Check if any king is now in check
    var found_check = false;
    var players = [board_util.kRedPlayer, board_util.kBluePlayer,
                   board_util.kYellowPlayer, board_util.kGreenPlayer];
    for (var p of players) {
      var kingLoc = temp.getKingLocation(p);
      if (kingLoc != null) {
        var team = p.getTeam();
        var otherTeam = team.equals(board_util.Team.RedYellow)
          ? board_util.Team.BlueGreen : board_util.Team.RedYellow;
        if (temp.isAttackedByTeam(otherTeam, kingLoc)) {
          found_check = true;
          break;
        }
      }
    }
    if (found_check) {
      // Check if it's checkmate (no legal moves) or just check
      var is_mate = (mv.getEndsGame() === true) || (temp.getAllLegalMoves().length === 0);
      move_annotations.push(is_mate ? '#' : '+');
    } else {
      move_annotations.push('');
    }
  }
}

// --- Display ---

function renderUserArrows(svg_parts, overlay_rect) {
  for (var a of user_arrows) {
    var from_cell = document.getElementById(`cell_${a.from_row}_${a.from_col}`);
    var to_cell = document.getElementById(`cell_${a.to_row}_${a.to_col}`);
    if (!from_cell || !to_cell) continue;
    var from_rect = from_cell.getBoundingClientRect();
    var to_rect = to_cell.getBoundingClientRect();
    var col = user_arrow_colors[a.color] || a.color;
    svg_parts.push(`
      <line x1="${from_rect.x - overlay_rect.x + from_rect.width / 2}"
            y1="${from_rect.y - overlay_rect.y + from_rect.height / 2}"
            x2="${to_rect.x - overlay_rect.x + to_rect.width / 2}"
            y2="${to_rect.y - overlay_rect.y + to_rect.height / 2}"
            stroke="${col}" stroke-width="7" opacity="0.8"
            marker-end="url(#arrow-${a.color})" />`);
  }
}

function displayBoard() {
  $('.cell').removeClass(piece_classes_str + ' eliminated engine-best-from engine-best-to last-move-red last-move-blue last-move-yellow last-move-green in-check user-hl-red user-hl-blue user-hl-green user-hl-yellow');

  var current_idx = move_index != null ? move_index : -1;
  Object.values(board.location_to_piece).forEach(function(loc_piece) {
    var loc, piece;
    [loc, piece] = loc_piece;
    var color_name = piece.getPlayer().getColor().name.toLowerCase();
    var piece_name = piece.getPieceType().name.toLowerCase();
    var row = loc.getRow();
    var col = loc.getCol();
    var cell_id = `cell_${row}_${col}`;
    var class_name = `${color_name}-${piece_name}`;
    var cell = $(`#${cell_id}`);
    cell.addClass(class_name);
    // Grey out pieces of eliminated players
    if (eliminations[color_name] != null && current_idx >= eliminations[color_name]) {
      cell.addClass('eliminated');
    }
  });

  // Highlight kings in check with red background
  var kings_in_check = getKingsInCheck();
  for (var color in kings_in_check) {
    var kLoc = kings_in_check[color];
    $(`#cell_${kLoc.getRow()}_${kLoc.getCol()}`).addClass('in-check');
  }

  // Render user square highlights
  for (var hl of user_highlights) {
    $(`#cell_${hl.row}_${hl.col}`).addClass('user-hl-' + hl.color);
  }

  const legal_move_indicator_class = 'legal-move-indicator';
  const legal_capture_indicator_class = 'legal-capture-indicator';
  $(`.${legal_move_indicator_class}`).removeClass(`${legal_move_indicator_class}`);
  $(`.${legal_capture_indicator_class}`).removeClass(`${legal_capture_indicator_class}`);

  if (legal_moves != null) {
    legal_moves.forEach(function(move) {
      var to = move.getTo();
      var row = to.getRow();
      var col = to.getCol();
      var cell_id = `#cell_${row}_${col}`;
      if (to in board.location_to_piece) {
        $(cell_id).append(`<div class='${legal_capture_indicator_class}'></div>`);
      } else {
        $(cell_id).append(`<div class='${legal_move_indicator_class}'></div>`);
      }
    });
  }

  // Highlight last move per player with their color
  var last_moves = getLastMovePerPlayer();
  for (var color in last_moves) {
    var lm = last_moves[color];
    if (lm != null) {
      var lm_from = lm.getFrom();
      var lm_to = lm.getTo();
      $(`#cell_${lm_from.getRow()}_${lm_from.getCol()}`).addClass('last-move-' + color);
      $(`#cell_${lm_to.getRow()}_${lm_to.getCol()}`).addClass('last-move-' + color);
    }
  }

  // --- Build move history with variations ---
  if (moves.length > 0) {
    var row_elements = [];
    var num_turns = Math.ceil(moves.length / 4);

    for (var turn = 0; turn < num_turns; turn++) {
      var cells = [];
      cells.push(`<div class='move-number'>${turn + 1}.</div>`);
      for (var col = 0; col < 4; col++) {
        var idx = turn * 4 + col;
        if (idx < moves.length) {
          var [mv, pt] = moves[idx];
          var cell_text = getMoveText(mv, pt);
          if (move_annotations[idx]) cell_text += move_annotations[idx];
          var cls_list = ['move-cell', colors[col]];
          if (active_branch == null && move_index == idx) {
            cls_list.push('move-current');
          }
          cells.push(`<div class='${cls_list.join(' ')}' data-type='main' data-idx='${idx}'>${cell_text}</div>`);
        } else {
          cells.push(`<div class='move-cell empty'></div>`);
        }
      }
      row_elements.push(`<div class='move-row'>${cells.join('')}</div>`);

      // Insert variation rows after any branch points in this turn
      for (var col = 0; col < 4; col++) {
        var bp = turn * 4 + col;
        if (branches[bp]) {
          for (var vi = 0; vi < branches[bp].length; vi++) {
            row_elements.push(buildVariationRows(bp, vi));
          }
        }
      }
    }

    var move_html = row_elements.join('');
    $('#move_history').html(move_html);

    // Click handlers — main line moves
    $('#move_history').off('click').on('click', '.move-cell[data-type="main"]', function() {
      var target = parseInt($(this).data('idx'));
      if (!isNaN(target)) {
        jumpToMainLine(target);
        displayBoard();
      }
    });

    // Click handlers — branch moves
    $('#move_history').on('click', '.move-cell[data-type="branch"]', function() {
      var bp = parseInt($(this).data('bp'));
      var vi = parseInt($(this).data('vi'));
      var bi = parseInt($(this).data('bi'));
      if (!isNaN(bp) && !isNaN(vi) && !isNaN(bi)) {
        jumpToBranch(bp, vi, bi);
        displayBoard();
      }
    });

    // Click handler — delete variation
    $('#move_history').on('click', '.var-close', function(e) {
      e.stopPropagation();
      var bp = parseInt($(this).data('bp'));
      var vi = parseInt($(this).data('vi'));
      // If we're in this branch, exit first
      if (active_branch != null && active_branch.from == bp && active_branch.idx == vi) {
        exitBranch();
      }
      branches[bp].splice(vi, 1);
      if (branches[bp].length == 0) delete branches[bp];
      // Fix active_branch index if needed
      if (active_branch != null && active_branch.from == bp && active_branch.idx > vi) {
        active_branch.idx--;
      }
      displayBoard();
    });

    // Auto-scroll to current move
    var current_el = $('#move_history .move-current');
    if (current_el.length) {
      current_el[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // --- Engine eval display ---
  var board_key = getBoardKey();
  var eval_results = board_key_to_eval[board_key];
  if (eval_results != null && 'evaluation' in eval_results) {
    var evaluation = Number(parseFloat(eval_results['evaluation']) / 100).toFixed(1);
    var search_depth = eval_results['search_depth'];
    var piece_eval = board.pieceEval();
    var static_eval = Number(parseFloat(eval_results['zero_move_evaluation']) / 100).toFixed(1);
    var eval_html = `eval: ${evaluation} static eval: ${static_eval} <br/> depth: ${search_depth} <br/> piece eval: ${piece_eval}`;
    var turn_info = `side to move: ${board.turn.getColor().name}`;
    $('#eval_estimate').html(eval_html);
    $('#turn_info').html(turn_info);

    // Display engine line (Stockfish-style)
    var principal_variation = eval_results['principal_variation'];
    var col_names = ['a','b','c','d','e','f','g','h','i','j','k','l','m','n'];
    var row_names = [14,13,12,11,10,9,8,7,6,5,4,3,2,1];
    if (principal_variation && principal_variation.length > 0) {
      var best = principal_variation[0];
      $(`#cell_${best['from']['row']}_${best['from']['col']}`).addClass('engine-best-from');
      $(`#cell_${best['to']['row']}_${best['to']['col']}`).addClass('engine-best-to');

      var pv_color_map = {red: '#e87272', blue: '#6bb5f0', yellow: '#d4c94a', green: '#6abf7b'};
      var line_parts = [];
      for (var pv_i = 0; pv_i < principal_variation.length; pv_i++) {
        var pv_move = principal_variation[pv_i];
        var pv_color_name = player_id_to_color[pv_move['turn']];
        var pv_color = pv_color_map[pv_color_name] || pv_color_name;
        var from_r = pv_move['from']['row'];
        var from_c = pv_move['from']['col'];
        var to_r = pv_move['to']['row'];
        var to_c = pv_move['to']['col'];
        var piece_at_from = board.getPieceRowCol(from_r, from_c);
        var piece_short = piece_at_from ? piece_at_from.getPieceType().short_name : '?';
        var from_sq = `${col_names[from_c]}${row_names[from_r]}`;
        var to_sq = `${col_names[to_c]}${row_names[to_r]}`;
        line_parts.push(`<span class="engine-line-move" style="color:${pv_color}">${piece_short}${from_sq}-${to_sq}</span>`);
      }

      var eval_bar_class = evaluation >= 0 ? 'eval-positive' : 'eval-negative';
      var engine_html = `<div class="engine-panel">`;
      engine_html += `<div class="engine-panel-header">`;
      engine_html += `<span class="engine-eval ${eval_bar_class}">${evaluation >= 0 ? '+' : ''}${evaluation}</span>`;
      engine_html += `<span class="engine-depth">depth ${search_depth}</span>`;
      engine_html += `</div>`;
      engine_html += `<div class="engine-line">${line_parts.join(' <span class="engine-arrow">&rarr;</span> ')}</div>`;
      engine_html += `</div>`;
      $('#best_move').html(engine_html);
    } else {
      $('#best_move').html('');
    }

    var svg_parts = [];
    for (const c of ['red', 'blue', 'yellow', 'green']) {
      svg_parts.push(`
        <defs>
          <marker id="arrow-${c}" fill="${user_arrow_colors[c]}" viewBox="0 0 10 10"
            refX="5" refY="5" markerWidth="3" markerHeight="3"
            orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>`);
    }

    var move_overlay = document.getElementById('move_overlay');
    var overlay_rect = move_overlay.getBoundingClientRect();
    for (const key_id in principal_variation) {
      const pv = principal_variation[key_id];
      const turn = pv['turn'];
      const pv_col = player_id_to_color[turn];
      const from_cell = document.getElementById(`cell_${pv['from']['row']}_${pv['from']['col']}`);
      const to_cell = document.getElementById(`cell_${pv['to']['row']}_${pv['to']['col']}`);
      const from_rect = from_cell.getBoundingClientRect();
      const to_rect = to_cell.getBoundingClientRect();
      var pv_hex = user_arrow_colors[pv_col] || pv_col;
      svg_parts.push(`
        <line x1="${from_rect.x - overlay_rect.x + from_rect.width / 2}"
              y1="${from_rect.y - overlay_rect.y + from_rect.height / 2}"
              x2="${to_rect.x - overlay_rect.x + to_rect.width / 2}"
              y2="${to_rect.y - overlay_rect.y + to_rect.height / 2}"
              stroke="${pv_hex}" stroke-width="8" opacity="0.6"
              marker-end="url(#arrow-${pv_col})" />`);
    }
    // User-drawn arrows
    renderUserArrows(svg_parts, overlay_rect);
    $('#move_svg').html(svg_parts.join('\n'));
  } else {
    // No engine eval — still render user arrows
    var svg_parts = [];
    for (const c of ['red', 'blue', 'yellow', 'green']) {
      svg_parts.push(`
        <defs>
          <marker id="arrow-${c}" fill="${user_arrow_colors[c]}" viewBox="0 0 10 10"
            refX="5" refY="5" markerWidth="3" markerHeight="3"
            orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>`);
    }
    if (user_arrows.length > 0) {
      var move_overlay = document.getElementById('move_overlay');
      var overlay_rect = move_overlay.getBoundingClientRect();
      renderUserArrows(svg_parts, overlay_rect);
    }
    $('#move_svg').html(svg_parts.join('\n'));
  }

  // Auto-save position
  saveState();
}

// Build HTML for a variation block
function buildVariationRows(bp, vi) {
  var branch = branches[bp][vi];
  var start_col = (bp + 1) % 4;
  var start_turn = Math.floor((bp + 1) / 4) + 1;

  var html = `<div class='var-block'>`;

  var cur_col = start_col;
  var cur_turn = start_turn;
  var row_cells = [];
  row_cells.push(`<div class='move-number var-number'>(${cur_turn}.</div>`);
  // Pad empty cells before first branch move
  for (var p = 0; p < start_col; p++) {
    row_cells.push(`<div class='move-cell empty'></div>`);
  }

  for (var bi = 0; bi < branch.length; bi++) {
    var [mv, pt] = branch[bi];
    var cell_text = getMoveText(mv, pt);
    if (mv.getEndsGame() === true) cell_text += '#';
    var col_color = colors[cur_col];
    var cls_list = ['move-cell', col_color];
    if (active_branch != null && active_branch.from == bp && active_branch.idx == vi && active_branch.pos == bi) {
      cls_list.push('move-current');
    }
    row_cells.push(`<div class='${cls_list.join(' ')}' data-type='branch' data-bp='${bp}' data-vi='${vi}' data-bi='${bi}'>${cell_text}</div>`);

    cur_col++;
    if (cur_col >= 4) {
      // Complete the row - add close button on first row only
      if (bi < 4) {
        row_cells.push(`<div class='var-close' data-bp='${bp}' data-vi='${vi}'>&times;</div>`);
      }
      html += `<div class='move-row var-row'>${row_cells.join('')}</div>`;
      row_cells = [];
      cur_col = 0;
      cur_turn++;
      if (bi < branch.length - 1) {
        row_cells.push(`<div class='move-number var-number'>${cur_turn}.</div>`);
      }
    }
  }

  // Flush remaining cells
  if (row_cells.length > 0) {
    // Pad remaining
    while (cur_col < 4) {
      row_cells.push(`<div class='move-cell empty'></div>`);
      cur_col++;
    }
    // Close button if not yet added
    if (branch.length <= 4) {
      row_cells.push(`<div class='var-close' data-bp='${bp}' data-vi='${vi}'>&times;</div>`);
    }
    // Add closing paren to last move
    html += `<div class='move-row var-row'>${row_cells.join('')})</div>`;
  } else {
    // Last row was complete, add paren
    html = html.slice(0, -6) + ')</div>'; // append to last </div>
  }

  html += `</div>`;
  return html;
}

const col_names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'];
const row_names = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

function getMoveText(move, piece_type) {
  var to = move.getTo();
  var from = move.getFrom();
  var row_name = row_names[to.getRow()];
  var col_name = col_names[to.getCol()];
  var piece_name = piece_type.short_name;
  var capture = move.getCapture();
  var sep = capture != null ? 'x' : '';
  // For pawn captures, show origin column (e.g. fxg12)
  if (piece_name === '' && capture != null) {
    piece_name = col_names[from.getCol()];
  }
  return `${piece_name}${sep}${col_name}${row_name}`;
}

// --- Navigation bar ---
var playback_interval = null;
var playback_active = false;

function stopPlayback() {
  if (playback_interval != null) {
    clearInterval(playback_interval);
    playback_interval = null;
  }
  playback_active = false;
  $('#nav_play').html('&#9654;').removeClass('nav-playing');
}

function startPlayback() {
  playback_active = true;
  $('#nav_play').html('&#9646;&#9646;').addClass('nav-playing');
  playback_interval = setInterval(function() {
    // Check if we can still advance
    if (active_branch != null) {
      var branch = branches[active_branch.from][active_branch.idx];
      if (active_branch.pos >= branch.length - 1) {
        stopPlayback();
        return;
      }
    } else if (move_index >= moves.length - 1) {
      stopPlayback();
      return;
    }
    maybeRedoMove(1);
  }, 1000);
}

function jumpToStart() {
  stopPlayback();
  if (active_branch != null) exitBranch();
  if (move_index >= 0) {
    jumpToMainLine(-1);
    displayBoard();
  }
}

function jumpToEnd() {
  stopPlayback();
  if (active_branch != null) {
    var branch = branches[active_branch.from][active_branch.idx];
    if (active_branch.pos < branch.length - 1) {
      jumpToBranch(active_branch.from, active_branch.idx, branch.length - 1);
      displayBoard();
    }
  } else if (move_index < moves.length - 1) {
    jumpToMainLine(moves.length - 1);
    displayBoard();
  }
}

$('#nav_start').click(function() { jumpToStart(); });
$('#nav_back4').click(function() { stopPlayback(); maybeUndoMove(4); });
$('#nav_back1').click(function() { stopPlayback(); maybeUndoMove(1); });
$('#nav_play').click(function() {
  if (playback_active) {
    stopPlayback();
  } else {
    startPlayback();
  }
});
$('#nav_fwd1').click(function() { stopPlayback(); maybeRedoMove(1); });
$('#nav_fwd4').click(function() { stopPlayback(); maybeRedoMove(4); });
$('#nav_end').click(function() { jumpToEnd(); });
$('#play_engine_move').click(function() { maybeMakeSuggestedMove(); });

// Board theme
function applyTheme(light, dark) {
  document.documentElement.style.setProperty('--sq-light', light);
  document.documentElement.style.setProperty('--sq-dark', dark);
  window.localStorage['theme_light'] = light;
  window.localStorage['theme_dark'] = dark;
  $('.theme-btn').removeClass('theme-active');
  $(`.theme-btn[data-light="${light}"][data-dark="${dark}"]`).addClass('theme-active');
}

// Restore saved theme
(function() {
  var sl = window.localStorage['theme_light'];
  var sd = window.localStorage['theme_dark'];
  if (sl && sd) applyTheme(sl, sd);
  else $('.theme-btn').first().addClass('theme-active');
})();

$('.theme-btn').click(function() {
  var light = $(this).data('light');
  var dark = $(this).data('dark');
  applyTheme(light, dark);
});

// Board rotation
$('#nav_rotate').click(function() {
  board_rotation = (board_rotation + 1) % 4;
  applyRotation();
  saveState();
});

function applyRotation() {
  var wrapper = $('.board-wrapper');
  wrapper.removeClass('rotate-0 rotate-90 rotate-180 rotate-270');
  // Rotation 0=red bottom, 1=blue bottom, 2=yellow bottom, 3=green bottom
  // CSS degrees needed: [0, 270, 180, 90] (counter-clockwise to bring left/top/right to bottom)
  var deg_map = [0, 270, 180, 90];
  var deg = deg_map[board_rotation];
  wrapper.addClass('rotate-' + deg);

  // Don't rotate the overlay — arrow coords are computed from visual cell positions
  // via getBoundingClientRect(), which already accounts for the board CSS rotation
  var overlay = $('#move_overlay');
  overlay.css('transform', 'none');

  // Update player labels around the board
  updatePlayerLabels();

  // Re-render to fix arrow positions
  displayBoard();
}

function updatePlayerLabels() {
  // Sides after each rotation (using deg_map [0, 270, 180, 90]):
  //   rotation 0 (0°):   top=yellow, right=green, bottom=red, left=blue
  //   rotation 1 (270°): top=green,  right=yellow, bottom=blue, left=red
  //   rotation 2 (180°): top=red,    right=blue,  bottom=yellow, left=green
  //   rotation 3 (90°):  top=blue,   right=red,   bottom=green, left=yellow
  // Corner mapping: TL=top, TR=right, BL=left, BR=bottom
  // [top-left, top-right, bottom-left, bottom-right]
  // TL=top player, TR=right player, BL=left player, BR=bottom player
  // deg_map = [0, 270, 180, 90]
  var layouts = [
    ['yellow', 'green', 'blue', 'red'],        // rotation 0 (0°): top=Y, right=G, left=B, bottom=R
    ['green', 'red', 'yellow', 'blue'],        // rotation 1 (270°): top=G, right=R, left=Y, bottom=B
    ['red', 'blue', 'green', 'yellow'],        // rotation 2 (180°): top=R, right=B, left=G, bottom=Y
    ['blue', 'yellow', 'red', 'green'],        // rotation 3 (90°): top=B, right=Y, left=R, bottom=G
  ];

  var layout = layouts[board_rotation];
  var corner_ids = ['#player_top_left', '#player_top_right', '#player_bottom_left', '#player_bottom_right'];

  for (var i = 0; i < 4; i++) {
    var color = layout[i];
    var name = player_names[color] || color.charAt(0).toUpperCase() + color.slice(1);
    var elo = player_elos[color];
    var elo_html = elo ? `<span class="pname-elo">(${elo})</span>` : '';
    var el = $(corner_ids[i]);
    el.removeClass('color-red color-blue color-yellow color-green');
    el.addClass('color-' + color);
    el.html(`${name}${elo_html}`);
  }
}

// --- Saved games functions ---

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateGameName() {
  var parts = [];
  var names = [];
  for (var c of ['red', 'blue', 'yellow', 'green']) {
    if (player_names[c]) names.push(player_names[c]);
  }
  if (names.length > 0) {
    parts.push(names.join(' vs '));
  }
  if (game_info.time_control) {
    var tc = formatTimeControl(game_info.time_control);
    if (tc) parts.push(tc);
  }
  if (game_info.variant) parts.push(game_info.variant);
  if (parts.length === 0) return 'Untitled Game';
  return parts.join(' \u2013 ');
}

function formatSavedDate(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  var now = new Date();
  var diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  return d.toLocaleDateString();
}

function refreshSavedGamesList(show_all) {
  fetch('/api/games')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var total = data.games ? data.games.length : 0;
      if (total === 0) {
        $('#saved_games_list').html('<div class="saved-games-empty">No saved games yet.</div>');
        return;
      }
      var shown = show_all ? data.games : data.games.slice(0, 5);
      var html = '';
      for (var g of shown) {
        var dateStr = formatSavedDate(g.updated_at);
        html += '<div class="saved-game-row" data-id="' + g.id + '">'
          + '<span class="saved-game-name" title="' + escapeHtml(g.name) + '">' + escapeHtml(g.name) + '</span>'
          + '<span class="saved-game-date">' + dateStr + '</span>'
          + '<button class="saved-game-delete" title="Delete">&times;</button>'
          + '</div>';
      }
      if (!show_all && total > 5) {
        html += '<div class="saved-games-more">' + (total - 5) + ' more\u2026</div>';
      }
      $('#saved_games_list').html(html);
    })
    .catch(function() {});
}

function saveCurrentGame(name) {
  var pgn = $('#pgn_input').val();
  if (!pgn) return;
  var body = {
    name: name,
    pgn: pgn,
    move_index: move_index != null ? move_index : -1,
    rotation: board_rotation,
    metadata: {
      player_names: player_names,
      player_elos: player_elos,
      time_control: game_info.time_control,
      variant: game_info.variant,
      rule_variants: game_info.rule_variants,
    }
  };
  fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  .then(function() { refreshSavedGamesList($('#saved_games_list').hasClass('visible')); })
  .catch(function() {});
}

function loadSavedGame(id) {
  fetch('/api/games/' + id)
    .then(function(r) { return r.json(); })
    .then(function(game) {
      $('#pgn_input').val(game.pgn);
      var res = utils.parseGameFromPGN(game.pgn);
      var mpt = [];
      for (var i = 0; i < res.moves.length; i++) {
        mpt.push([res.moves[i], res.piece_types[i]]);
      }
      resetBoard(res.board, mpt, res.player_names, res.player_elos, res.game_info, res.eliminations);
      if (game.move_index != null && game.move_index >= -1 && game.move_index < moves.length) {
        jumpToMainLine(game.move_index);
      }
      if (game.rotation != null && game.rotation >= 0 && game.rotation <= 3) {
        board_rotation = game.rotation;
      }
      applyRotation();
      displayBoard();
      saveState();
      $('#saved_games_list').removeClass('visible');
    })
    .catch(function() {});
}

function deleteSavedGame(id) {
  fetch('/api/games/' + id, { method: 'DELETE' })
    .then(function() { refreshSavedGamesList($('#saved_games_list').hasClass('visible')); })
    .catch(function() {});
}

function formatTimeControl(tc) {
  // Parse "120+10" or "2+10" style time controls
  // chess.com uses seconds format like "120+10" (120s base + 10s increment)
  // but also "2+10" could mean 2 min + 10 sec
  if (!tc) return null;
  var parts = tc.split('+');
  if (parts.length !== 2) return tc;
  var base = parseInt(parts[0]);
  var inc = parseInt(parts[1]);
  if (isNaN(base) || isNaN(inc)) return tc;
  // If base >= 60, treat as seconds; otherwise treat as minutes
  if (base >= 60) base = Math.floor(base / 60);
  return `${base} | ${inc}`;
}

function detectRuleVariantTags(rule_variants) {
  if (!rule_variants) return [];
  var tags = [];
  // Only show meaningful tags (skip EnPassant/Pawn2Squares as they're standard)
  var display = ['Modern', 'SelfPartner', 'Anonymous'];
  for (var tag of display) {
    if (rule_variants.includes(tag)) {
      tags.push(tag.toUpperCase());
    }
  }
  return tags;
}

function updateGameTitle() {
  var el = $('#game_title');
  if (!game_info.time_control && !game_info.variant && !game_info.rule_variants) {
    el.removeClass('visible').html('');
    return;
  }
  var parts = [];
  var tc = formatTimeControl(game_info.time_control);
  if (tc) parts.push(`<span class="gt-time">${tc}</span>`);
  if (game_info.variant) parts.push(`<span class="gt-variant">${game_info.variant}</span>`);
  var tags = detectRuleVariantTags(game_info.rule_variants);
  for (var tag of tags) {
    parts.push(`<span class="gt-tag">${tag}</span>`);
  }
  if (parts.length > 0) {
    el.html(parts.join(' ')).addClass('visible');
  } else {
    el.removeClass('visible').html('');
  }
}

function updatePlayerNamesBar() {
  // Player names are now shown in corner labels around the board
  updatePlayerLabels();
}

$("body").keydown(function(e) {
  // Ignore shortcuts when typing in an input/textarea
  var tag = e.target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;

  if(e.keyCode == 37) { // left
    stopPlayback(); maybeUndoMove();
  } else if (e.keyCode == 39) { // right
    stopPlayback(); maybeRedoMove();
  } else if (e.keyCode == 38) { // up
    stopPlayback(); maybeUndoMove(4);
  } else if (e.keyCode == 40) { // down
    stopPlayback(); maybeRedoMove(4);
  } else if (e.keyCode == 32) { // space
    e.preventDefault();
    maybeMakeSuggestedMove();
  } else if (e.keyCode == 36) { // home
    jumpToStart();
  } else if (e.keyCode == 35) { // end
    jumpToEnd();
  } else if (e.key === 'r' || e.key === 'R') { // rotate board 90°
    board_rotation = (board_rotation + 1) % 4;
    applyRotation();
    saveState();
  } else if (e.key === 'f' || e.key === 'F') { // flip board 180°
    board_rotation = (board_rotation + 2) % 4;
    applyRotation();
    saveState();
  } else if (e.key === 'p' || e.key === 'P') { // toggle auto-play
    if (playback_active) {
      stopPlayback();
    } else {
      startPlayback();
    }
  } else if (e.key === 'e' || e.key === 'E') { // play engine move
    maybeMakeSuggestedMove();
  } else if (e.key === 'n' || e.key === 'N') { // new game
    $('#pgn_input').val('');
    $('#pgn_error').text('');
    resetBoard();
    displayBoard();
    try { delete window.localStorage['saved_pgn']; } catch(e2) {}
    saveState();
  } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) { // Ctrl+S = save game
    e.preventDefault();
    var pgn = $('#pgn_input').val();
    if (pgn) {
      saveCurrentGame(generateGameName());
    }
  }
});

var requests_in_flight = {};
var last_board_key = null;
var controller = new AbortController();
var signal = controller.signal;

function getBoardState() {
  var state = {};
  state['turn'] = board.turn.getColor().name;
  state['board'] = [];
  for (let key in board.location_to_piece) {
    var loc, piece;
    [loc, piece] = board.location_to_piece[key];
    var item = {
      'row': loc.getRow(),
      'col': loc.getCol(),
      'pieceType': piece.getPieceType().name,
      'color': piece.getColor().name,
    };
    state['board'].push(item);
  }
  state['castling_rights'] = {};
  var players = [
      board_util.kRedPlayer,
      board_util.kBluePlayer,
      board_util.kYellowPlayer,
      board_util.kGreenPlayer];
  for (var i = 0; i < players.length; i++) {
    var player = players.at(i);
    var rights = board.castling_rights[player];
    var item = {
      'kingside': rights.getKingside(),
      'queenside': rights.getQueenside(),
    };
    state['castling_rights'][player.getColor().name] = item;
  }
  return state;
}

function getBoardKey() {
  return board.moves.toString();
}

function handleResponse(req_key, req_depth, data) {
  if (req_key in requests_in_flight) {
    var depth = requests_in_flight[req_key];
    if (depth <= req_depth) {
      delete requests_in_flight[req_key];
    }
  }
  if (data != null && 'evaluation' in data) {
    data['req_depth'] = req_depth;
    board_key_to_eval[req_key] = data;
    displayBoard();
  }
}

function handleError(req_key, req_depth, error) {
  if (req_key in requests_in_flight) {
    var depth = requests_in_flight[req_key];
    if (depth <= req_depth) {
      delete requests_in_flight[req_key];
    }
  }
}

function requestBoardEvaluation() {
  var req_key = getBoardKey();
  var req_pending = (req_key in requests_in_flight);

  if (!req_pending || req_key != last_board_key) {
    if (req_pending) {
      controller.abort();
      controller = new AbortController();
      signal = controller.signal;
    }

    var eval_results = board_key_to_eval[req_key];

    var search_depth = 1;
    if (secs_per_move != null && max_search_depth != null) {
      search_depth = max_search_depth;
    } else if (eval_results != null && 'req_depth' in eval_results) {
      search_depth = eval_results['req_depth'] + 1;
      if ('evaluation' in eval_results
          && Math.abs(eval_results['evaluation']) == MATE_VALUE) {
        return;
      }
    }

    var board_state = getBoardState();
    var req_body = {
      'board_state': board_state,
      'search_depth': search_depth,
    }
    if (secs_per_move != null) {
      req_body['secs_per_move'] = secs_per_move;
    }
    var req_text = JSON.stringify(req_body);
    var options = {
      method: 'POST',
      headers: {
        "Content-Type": "application/json",
      },
      body: req_text,
      signal: signal,
    }

    if (max_search_depth != null && search_depth > max_search_depth) {
      return;
    }

    requests_in_flight[req_key] = search_depth;
    last_board_key = req_key;
    fetch('/chess-api', options)
      .then((response) => response.json())
      .then((response) => { handleResponse(req_key, search_depth, response); })
      .catch((response) => { handleError(req_key, search_depth, response); });
  }
}

})()
