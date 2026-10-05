import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { Public } from "@aforo/common/nest";
import { LoginRequestDto } from "./login-request.dto";
import { LoginService } from "./login.service";

@Controller("api/v1/auth")
export class LoginController {
  constructor(private readonly loginService: LoginService) {}

  @Post("login")
  @Public()
  @HttpCode(200)
  login(@Body() body: LoginRequestDto) {
    return this.loginService.login(body);
  }
}
