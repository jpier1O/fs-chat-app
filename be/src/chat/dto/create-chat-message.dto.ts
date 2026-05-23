import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateChatMessageDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  message!: string;
}
