import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';
import { SudokuService, Board } from './sudoku.service';
import { StickmanGameComponent } from './stickman-game.component';
import { CityJumperComponent } from './city-jumper.component';
import { EverestClimbComponent } from './everest-climb.component';
import { BikeRideComponent } from './bike-ride.component';
import { ChessGameComponent } from './chess-game.component';

type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
type Menu = 'home' | 'sudoku' | 'stickman' | 'cityjumper' | 'everest' | 'bikeride' | 'chess';

@Component({
  selector: 'app-root',
  imports: [StickmanGameComponent, CityJumperComponent, EverestClimbComponent, BikeRideComponent, ChessGameComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit, OnDestroy {
  message = signal('Loading...');
  error = signal('');
  activeMenu = signal<Menu>('home');

  puzzle = signal<Board>([]);
  solution = signal<Board>([]);
  userBoard = signal<Board>([]);
  selected = signal<[number, number] | null>(null);
  solved = signal(false);
  showErrors = signal(false);
  difficulty = signal<Difficulty>('medium');
  timerSec   = signal(0);

  private timerInterval: ReturnType<typeof setInterval> | null = null;

  readonly difficultyClues: Record<Difficulty, number> = {
    easy: 46, medium: 35, hard: 26, expert: 20
  };

  get timerDisplay(): string {
    const s = this.timerSec();
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  }

  readonly indices = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  readonly numpad = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  constructor(private http: HttpClient, private sudoku: SudokuService) {}

  ngOnInit(): void {
    this.http.get<{ message: string }>(`${environment.apiUrl}/api/hello`).subscribe({
      next: (res) => this.message.set(res.message),
      error: () => this.error.set('Failed to reach the API.')
    });
    this.newGame();
  }

  ngOnDestroy(): void { this.stopTimer(); }

  setDifficulty(d: Difficulty): void { this.difficulty.set(d); this.newGame(); }

  newGame(): void {
    this.stopTimer();
    const { puzzle, solution } = this.sudoku.generatePuzzle(this.difficultyClues[this.difficulty()]);
    this.puzzle.set(puzzle);
    this.solution.set(solution);
    this.userBoard.set(puzzle.map(r => [...r]));
    this.selected.set(null);
    this.solved.set(false);
    this.showErrors.set(false);
    this.startTimer();
  }

  private startTimer(): void {
    this.timerSec.set(0);
    this.timerInterval = setInterval(() => this.timerSec.update(s => s + 1), 1000);
  }

  private stopTimer(): void {
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
  }

  selectCell(r: number, c: number): void {
    if (!this.isGiven(r, c) && !this.solved()) this.selected.set([r, c]);
  }

  isGiven(r: number, c: number): boolean {
    return this.puzzle()[r][c] !== null;
  }

  isSelected(r: number, c: number): boolean {
    const s = this.selected();
    return !!s && s[0] === r && s[1] === c;
  }

  isHighlighted(r: number, c: number): boolean {
    const s = this.selected();
    if (!s) return false;
    return s[0] === r || s[1] === c ||
      (Math.floor(s[0] / 3) === Math.floor(r / 3) &&
       Math.floor(s[1] / 3) === Math.floor(c / 3));
  }

  isError(r: number, c: number): boolean {
    if (!this.showErrors()) return false;
    const val = this.userBoard()[r][c];
    return val !== null && val !== this.solution()[r][c];
  }

  cellDisplay(r: number, c: number): string {
    const val = this.userBoard()[r][c];
    return val !== null ? String(val) : '';
  }

  onKeyDown(event: KeyboardEvent): void {
    const s = this.selected();
    if (!s) return;
    const [r, c] = s;

    if (event.key >= '1' && event.key <= '9') {
      this.enter(r, c, +event.key);
    } else if (['Backspace', 'Delete', '0'].includes(event.key)) {
      this.enter(r, c, null);
    } else if (event.key === 'ArrowUp')    this.move(r - 1, c);
    else if (event.key === 'ArrowDown')   this.move(r + 1, c);
    else if (event.key === 'ArrowLeft')   this.move(r, c - 1);
    else if (event.key === 'ArrowRight')  this.move(r, c + 1);
  }

  numpadInput(n: number): void {
    const s = this.selected();
    if (s) this.enter(s[0], s[1], n);
  }

  erase(): void {
    const s = this.selected();
    if (s) this.enter(s[0], s[1], null);
  }

  check(): void { this.showErrors.set(true); }

  private enter(r: number, c: number, val: number | null): void {
    if (this.isGiven(r, c) || this.solved()) return;
    const board = this.userBoard().map(row => [...row]) as Board;
    board[r][c] = val;
    this.userBoard.set(board);
    this.showErrors.set(false);
    if (this.sudoku.isSolved(board, this.solution())) { this.solved.set(true); this.stopTimer(); }
  }

  private move(r: number, c: number): void {
    if (r >= 0 && r < 9 && c >= 0 && c < 9 && !this.isGiven(r, c))
      this.selected.set([r, c]);
  }
}
