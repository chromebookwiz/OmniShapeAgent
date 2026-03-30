# Chess Game & AI Strategy

## Game Overview
- **Type**: Two-player abstract strategy game
- **Board**: 8x8 grid (64 squares)
- **Pieces**: King, Queen, Rook, Bishop, Knight, Pawn
- **Objective**: Checkmate the opponent's King

## Board Representation
- **Notation**: Standard algebraic (e.g., e4, Nf3)
- **Internal Format**: 8x8 array or FEN string
- **Color Codes**: 
  - `1` = White pieces
  - `2` = Black pieces
  - `0` = Empty

## AI Strategy (Minimax with Alpha-Beta Pruning)
1. **Evaluation Function**: 
   - Material count (Queen=9, Rook=5, Bishop/Knight=3, Pawn=1)
   - Positional bonuses (center control, pawn structure, king safety)
2. **Search Depth**: 3-4 plies (adjustable for speed vs. strength)
3. **Move Ordering**: Captures first, then checks, then quiet moves

## Key Tactics
- **Opening Principles**: Control center, develop pieces, castle king
- **Middlegame**: Attack weaknesses, coordinate pieces, create passed pawns
- **Endgame**: King activity, pawn promotion, opposition

## Special Rules
- **Castling**: King moves 2 squares, Rook jumps over
- **En Passant**: Pawn capture rule (specific conditions)
- **Promotion**: Pawn reaches 8th rank becomes Queen/Rook/Bishop/Knight
- **Draws**: Stalemate, insufficient material, 50-move rule, repetition

## Integration with OmniShapeAgent
- `play_chess_move(color, move)` -> Returns board state
- `evaluate_board(board)` -> Returns score (positive = White advantage)
- `get_best_move(board, color, depth)` -> Returns optimal move

## Skill Version: 1.0
## Status: Active & Ready for Play
