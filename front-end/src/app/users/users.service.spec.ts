import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../environments/environment';
import { CreateUserRequest, User } from './user.model';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let httpMock: HttpTestingController;
  const baseUrl = `${environment.apiUrl}/users`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(UsersService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should GET the users list from the gateway', () => {
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

    service.findAll().subscribe((response) => {
      expect(response).toEqual(users);
    });

    const request = httpMock.expectOne(baseUrl);
    expect(request.request.method).toBe('GET');
    request.flush(users);
  });

  it('should POST a new user to the gateway', () => {
    const createRequest: CreateUserRequest = { email: 'b@example.com', name: 'B' };
    const createdUser: User = {
      id: '2',
      version: 1,
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
      ...createRequest,
    };

    service.create(createRequest).subscribe((response) => {
      expect(response).toEqual(createdUser);
    });

    const request = httpMock.expectOne(baseUrl);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(createRequest);
    request.flush(createdUser);
  });
});
