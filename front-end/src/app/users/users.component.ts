import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { User } from './user.model';
import { UsersService } from './users.service';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './users.component.html',
  styleUrl: './users.component.scss',
})
export class UsersComponent implements OnInit {
  users: User[] = [];
  loading = false;
  error: string | null = null;

  newUserEmail = '';
  newUserName = '';
  submitting = false;

  constructor(private readonly usersService: UsersService) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  loadUsers(): void {
    this.loading = true;
    this.error = null;

    this.usersService.findAll().subscribe({
      next: (users) => {
        this.users = users;
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not reach the gateway. Is it running on http://localhost:3000?';
        this.loading = false;
      },
    });
  }

  createUser(): void {
    if (!this.newUserEmail || !this.newUserName) {
      return;
    }

    this.submitting = true;
    this.error = null;

    this.usersService.create({ email: this.newUserEmail, name: this.newUserName }).subscribe({
      next: () => {
        this.newUserEmail = '';
        this.newUserName = '';
        this.submitting = false;
        this.loadUsers();
      },
      error: (response) => {
        this.error = response?.error?.error?.message ?? 'Could not create the user.';
        this.submitting = false;
      },
    });
  }
}
