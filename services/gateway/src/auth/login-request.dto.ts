import { Transform } from "class-transformer";
import { IsEmail, IsString, Length } from "class-validator";

export class LoginRequestDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 80)
  displayName!: string;
}
