export interface ICursorPage<T> {
  data: T[];
  nextCursor?: string;
}
