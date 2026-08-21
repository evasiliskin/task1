export interface IGithubActor {
  id: number;
  login: string;
}

export interface IGithubRepository {
  id: number;
  name: string;
}

export interface IGithubOrganization {
  id: number;
  login: string;
}

export interface IGithubEventDocument {
  eventId: string;
  eventType: string;
  createdAt: Date;
  actor: IGithubActor;
  repo: IGithubRepository;
  org?: IGithubOrganization;
  importId: string;
  payload: Record<string, unknown>;
}
