import { IsInt, IsOptional, IsString, IsUUID, Min, MaxLength, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsUUID()
  public id!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  public name?: string;

  @IsInt()
  @Min(1)
  public version!: number;
}
