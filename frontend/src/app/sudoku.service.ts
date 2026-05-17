import { Injectable } from '@angular/core';

export type Board = (number | null)[][];

@Injectable({ providedIn: 'root' })
export class SudokuService {

  generatePuzzle(clues = 35): { puzzle: Board; solution: Board } {
    const solution = this.generateSolution();
    const puzzle = this.removeCells(solution, 81 - clues);
    return { puzzle, solution };
  }

  isSolved(board: Board, solution: Board): boolean {
    return board.every((row, r) => row.every((val, c) => val === solution[r][c]));
  }

  isEntryValid(board: Board, row: number, col: number): boolean {
    const val = board[row][col];
    if (val === null) return true;
    board[row][col] = null;
    const ok = this.canPlace(board, row, col, val);
    board[row][col] = val;
    return ok;
  }

  private generateSolution(): Board {
    const board: Board = Array.from({ length: 9 }, () => Array(9).fill(null));
    this.fillBoard(board);
    return board;
  }

  private fillBoard(board: Board): boolean {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] === null) {
          for (const n of this.shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
            if (this.canPlace(board, r, c, n)) {
              board[r][c] = n;
              if (this.fillBoard(board)) return true;
              board[r][c] = null;
            }
          }
          return false;
        }
      }
    }
    return true;
  }

  private canPlace(board: Board, row: number, col: number, n: number): boolean {
    if (board[row].includes(n)) return false;
    if (board.some(r => r[col] === n)) return false;
    const br = Math.floor(row / 3) * 3;
    const bc = Math.floor(col / 3) * 3;
    for (let r = br; r < br + 3; r++)
      for (let c = bc; c < bc + 3; c++)
        if (board[r][c] === n) return false;
    return true;
  }

  private removeCells(solution: Board, count: number): Board {
    const puzzle = solution.map(r => [...r]) as Board;
    const cells = this.shuffled([...Array(81).keys()]);
    for (let i = 0; i < count; i++) {
      const r = Math.floor(cells[i] / 9);
      const c = cells[i] % 9;
      puzzle[r][c] = null;
    }
    return puzzle;
  }

  private shuffled<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
