import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  public email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  public name!: string;
}
