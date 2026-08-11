import { IsUUID } from 'class-validator';

export class FindOneDto {
  @IsUUID()
  public id!: string;
}
