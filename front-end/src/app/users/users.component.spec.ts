import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { User } from './user.model';
import { UsersComponent } from './users.component';
import { UsersService } from './users.service';

describe('UsersComponent', () => {
  let component: UsersComponent;
  let usersService: jasmine.SpyObj<UsersService>;

  const users: User[] = [
    {
      id: '1',
      email: 'a@example.com',
      name: 'A',
      version: 1,
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
    },
  ];

  beforeEach(async () => {
    usersService = jasmine.createSpyObj<UsersService>('UsersService', ['findAll', 'create']);
    usersService.findAll.and.returnValue(of(users));

    await TestBed.configureTestingModule({
      imports: [UsersComponent],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compileComponents();

    component = TestBed.createComponent(UsersComponent).componentInstance;
  });

  it('should load users on init', () => {
    component.ngOnInit();

    expect(usersService.findAll).toHaveBeenCalled();
    expect(component.users).toEqual(users);
    expect(component.loading).toBe(false);
    expect(component.error).toBeNull();
  });

  it('should set an error message, when loading users fails', () => {
    usersService.findAll.and.returnValue(throwError(() => new Error('network error')));

    component.loadUsers();

    expect(component.error).toBe(
      'Could not reach the gateway. Is it running on http://localhost:3000?',
    );
    expect(component.loading).toBe(false);
  });

  it('should not submit, when the email or name is missing', () => {
    component.newUserEmail = '';
    component.newUserName = 'Name';

    component.createUser();

    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('should create the user and reload the list, when the form is valid', () => {
    const createdUser = users[0];
    usersService.create.and.returnValue(of(createdUser));
    component.newUserEmail = createdUser.email;
    component.newUserName = createdUser.name;

    component.createUser();

    expect(usersService.create).toHaveBeenCalledWith({
      email: createdUser.email,
      name: createdUser.name,
    });
    expect(component.newUserEmail).toBe('');
    expect(component.newUserName).toBe('');
    expect(component.submitting).toBe(false);
  });

  it('should surface the server error message, when creating a user fails', () => {
    usersService.create.and.returnValue(
      throwError(() => ({ error: { error: { message: 'Email already taken' } } })),
    );
    component.newUserEmail = 'taken@example.com';
    component.newUserName = 'Taken';

    component.createUser();

    expect(component.error).toBe('Email already taken');
    expect(component.submitting).toBe(false);
  });
});
