import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
	constructor(configService: ConfigService) {
		const secret = configService.get<string>("JWT_SECRET");
		if (!secret) {
			throw new Error(
				"JWT_SECRET environment variable is required. Set a strong random value in production.",
			);
		}
		super({
			jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
			ignoreExpiration: false,
			secretOrKey: secret,
			algorithms: ["HS256"],
		});
	}

	validate = (payload: Record<string, unknown>): Record<string, unknown> => {
		return { userId: payload.sub, email: payload.email, role: payload.role };
	};
}
