import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { GeminiApiException } from '../exceptions/gemini-api.exception';

interface HttpResponseShape {
  message?: string | string[];
  statusCode?: number;
}

interface ResponseBody {
  statusCode: number;
  message: string;
  timestamp: string;
  path: string;
  errorDetails?: unknown;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    const errorDetails: unknown = null;

    if (exception instanceof GeminiApiException) {
      status = exception.getStatus();
      const responseShape = exception.getResponse() as HttpResponseShape;
      message = this.extractMessage(responseShape, exception.message);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const responseShape = exception.getResponse();
      message =
        typeof responseShape === 'string'
          ? responseShape
          : this.extractMessage(responseShape, exception.message);
    } else if (exception instanceof Error) {
      const text = exception.message;
      if (
        text.includes('Gemini API quota exceeded') ||
        text.includes('Rate limit') ||
        text.includes('429')
      ) {
        status = HttpStatus.TOO_MANY_REQUESTS;
      } else if (text.includes('API key')) {
        status = HttpStatus.UNAUTHORIZED;
      } else if (
        text.includes('AI strategy generation failed') ||
        text.includes('AI response parsing failed')
      ) {
        status = HttpStatus.BAD_REQUEST;
      }
      message = text;
    }

    this.logger.error(
      `${request.method} ${request.url} -> ${status} ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    const body: ResponseBody = {
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };
    if (errorDetails) {
      body.errorDetails = errorDetails;
    }

    response.status(status).json(body);
  }

  private extractMessage(shape: HttpResponseShape, fallback: string): string {
    if (typeof shape.message === 'string') return shape.message;
    if (Array.isArray(shape.message)) return shape.message.join('; ');
    return fallback;
  }
}
