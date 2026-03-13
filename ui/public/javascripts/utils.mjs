import * as board_util from './board.mjs';

export function toFEN(board) {
  // TODO
}

export function toPGN(board) {
  // TODO
}

export function parseBoardFromFEN(fen_str) {
  // TODO
}

export function parseBoardLocation(loc_str) {
  const re = /[a-n]\d+/;
  if (!re.test(loc_str)) {
    throw new Error(`Invalid location string: ${loc_str}`);
  }
  var m = loc_str.match(re)[0];
  var col = 'abcdefghijklmn'.indexOf(m[0]);
  var row = 14 - parseInt(m.substr(1));
  return new board_util.BoardLocation(row, col);
}

function getInitialKingLocation(turn) {
  // NOTE: This could also handle the initial board configuration (standard,
  // old, byg, etc.)
  if (turn.equals(board_util.kRedPlayer)) {
    return new board_util.BoardLocation(13, 7);
  } else if (turn.equals(board_util.kBluePlayer)) {
    return new board_util.BoardLocation(7, 0);
  } else if (turn.equals(board_util.kYellowPlayer)) {
    return new board_util.BoardLocation(0, 6);
  } else if (turn.equals(board_util.kGreenPlayer)) {
    return new board_util.BoardLocation(6, 13);
  }
  throw new Error(`Invalid turn: ${turn}`);
}

function getCastlingLocation(from, turn, kingside) {
  var delta_row = 0;
  var delta_col = 0;

  if (turn.equals(board_util.kRedPlayer)) {
    delta_col = kingside ? 2 : -2;
  } else if (turn.equals(board_util.kBluePlayer)) {
    delta_row = kingside ? 2 : -2;
  } else if (turn.equals(board_util.kYellowPlayer)) {
    delta_col = kingside ? -2: 2;
  } else if (turn.equals(board_util.kGreenPlayer)) {
    delta_row = kingside ? -2: 2;
  } else {
    throw new Error(`Invalid turn: ${turn}`);
  }

  return new board_util.BoardLocation(from.getRow() + delta_row,
                                      from.getCol() + delta_col);
}

function maybeParsePromotionPieceType(move_str) {
  const re = /=([NBRQ])/;
  if (re.test(move_str)) {
    var piece_type = move_str.match(re)[1];
    if (piece_type == 'N') {
      return board_util.KNIGHT;
    } else if (piece_type == 'B') {
      return board_util.BISHOP;
    } else if (piece_type == 'R') {
      return board_util.ROOK;
    } else if (piece_type == 'Q') {
      return board_util.QUEEN;
    }
  }
  return null;
}

export function parseMove(board, move_str) {
  if (move_str == '#' || move_str == 'R' || move_str == 'T') {
    return null;
  }
  // Strip trailing # from moves like Qk8-m10#
  move_str = move_str.replace(/#$/, '');
  var from = null;
  var to = null;
  var promotion_piece_type = null;
  if (move_str == 'O-O') {
    // Castle kingside
    from = getInitialKingLocation(board.getTurn());
    to = getCastlingLocation(from, board.getTurn(), true);
  } else if (move_str == 'O-O-O') {
    // Castle queenside
    from = getInitialKingLocation(board.getTurn());
    to = getCastlingLocation(from, board.getTurn(), false);
  } else {
    var parts = move_str.split(/[-x]/);
    if (parts.length != 2) {
      // Possibly an incomplete/truncated move — skip it
      return null;
    }
    from = parseBoardLocation(parts[0]);
    to = parseBoardLocation(parts[1]);
    promotion_piece_type = maybeParsePromotionPieceType(move_str);
  }
  var legal_moves = board.getAllLegalMoves();
  for (const move of legal_moves) {
    if (move.getFrom().equals(from)
        && move.getTo().equals(to)
        && promotion_piece_type == move.getPromotionPieceType()) {
      return move;
    }
  }
  throw new Error(`Illegal move: ${move_str}`);
}

export function parseGameFromPGN(pgn_str) {
  // Extract player names and ELOs from PGN headers before stripping them
  var player_names = {red: null, blue: null, yellow: null, green: null};
  var player_elos = {red: null, blue: null, yellow: null, green: null};
  var name_re = /^\[(Red|Blue|Yellow|Green)\s+"([^"]*)"\]$/gmi;
  var name_match;
  while ((name_match = name_re.exec(pgn_str)) !== null) {
    player_names[name_match[1].toLowerCase()] = name_match[2];
  }
  var elo_re = /^\[(Red|Blue|Yellow|Green)Elo\s+"([^"]*)"\]$/gmi;
  var elo_match;
  while ((elo_match = elo_re.exec(pgn_str)) !== null) {
    player_elos[elo_match[1].toLowerCase()] = elo_match[2];
  }

  // Extract game info from PGN headers
  var game_info = {time_control: null, variant: null, rule_variants: null};
  var tc_re = /^\[TimeControl\s+"([^"]*)"\]$/gmi;
  var tc_match;
  while ((tc_match = tc_re.exec(pgn_str)) !== null) {
    game_info.time_control = tc_match[1];
  }
  var var_re = /^\[Variant\s+"([^"]*)"\]$/gmi;
  var var_match;
  while ((var_match = var_re.exec(pgn_str)) !== null) {
    game_info.variant = var_match[1];
  }

  // Detect SelfPartner mode: one player controls red+yellow, another controls blue+green
  var is_self_partner = false;
  var variant_re = /^\[RuleVariants\s+"([^"]*)"\]$/gmi;
  var variant_match;
  while ((variant_match = variant_re.exec(pgn_str)) !== null) {
    game_info.rule_variants = variant_match[1];
    if (variant_match[1].includes('SelfPartner')) {
      is_self_partner = true;
    }
  }
  if (is_self_partner) {
    // Red controls Yellow, Blue controls Green
    if (player_names.red && !player_names.yellow) player_names.yellow = player_names.red;
    if (player_names.blue && !player_names.green) player_names.green = player_names.blue;
    if (player_elos.red && !player_elos.yellow) player_elos.yellow = player_elos.red;
    if (player_elos.blue && !player_elos.green) player_elos.green = player_elos.blue;
  }

  // Remove variations (parenthesized)
  pgn_str = pgn_str.replaceAll(/\(.*?\)/gs, '');
  // Remove clock annotations like {[%clk 0:01:58]}
  pgn_str = pgn_str.replaceAll(/\{[^}]*\}/g, '');
  // Remove PGN headers like [Event "..."]
  pgn_str = pgn_str.replaceAll(/^\[.*\]$/gm, '');
  // Remove check symbols (preserve standalone # for checkmate elimination)
  pgn_str = pgn_str.replaceAll(/\+/g, '');
  // Remove result markers
  pgn_str = pgn_str.replaceAll(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, '');

  var parts = pgn_str.split('\n');
  const re = /^\d+\.\s*(.*)$/;
  var moves = [];
  var piece_types = [];
  var eliminations = {}; // {color: move_index} — move index after which that player's pieces are grey
  var player_order = ['red', 'blue', 'yellow', 'green'];
  // TODO: handle other types of start fen positions
  var board = board_util.Board.CreateStandardSetup();
  var matched_lines = 0;
  for (var part of parts) {
    part = part.trim();
    if (part === '') continue;
    if (re.test(part)) {
      matched_lines += 1;
      var move_strs = part.match(re)[1].replaceAll('..', '').trim().split(/\s+/);
      // Filter out empty strings from splitting
      move_strs = move_strs.filter(s => s !== '');
      if (move_strs.length > 4) {
        console.log('part', part, 'move_strs', move_strs);
        throw new Error(
            `Expected <= 4 moves per line, found ${move_strs.length}: ${move_strs.join(', ')}`);
      }
      for (var i = 0; i < move_strs.length; i++) {
        var token = move_strs[i];
        if (token === '#' || token === 'R' || token === 'T') {
          // Push a virtual elimination entry — no board state change
          var elim = {elimination: true, type: token, color: player_order[i]};
          moves.push(elim);
          piece_types.push(null);
          eliminations[player_order[i]] = moves.length - 1;
          continue;
        }
        var move = parseMove(board, token);
        if (move != null) {
          piece_types.push(board.getPiece(move.getFrom()).getPieceType());
          board.makeMove(move);
          moves.push(move);
        }
      }
    }
  }
  if (matched_lines == 0) {
    throw new Error('Invalid PGN: no moves found. Expected lines like "1. e2-e4 .. Ni10-h8 .. i13-i11 .. Ng5-h7"');
  }
  return {'board': board, 'moves': moves, 'piece_types': piece_types, 'player_names': player_names, 'player_elos': player_elos, 'game_info': game_info, 'eliminations': eliminations};
}

