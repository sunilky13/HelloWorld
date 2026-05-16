import { Component, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  message = signal<string>('Loading...');
  error = signal<string>('');

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.http.get<{ message: string }>(`${environment.apiUrl}/api/hello`).subscribe({
      next: (res) => this.message.set(res.message),
      error: () => this.error.set('Failed to reach the API.')
    });
  }
}
