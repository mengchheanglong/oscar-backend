import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadedFoldersService } from './uploaded-folders.service';
@Injectable()
export class UploadedFolderWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private stopping = false;
  constructor(
    private readonly folders: UploadedFoldersService,
    private readonly config: ConfigService,
  ) {}
  onModuleInit() {
    if (this.config.get('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => {
      if (!this.active && !this.stopping)
        this.active = this.tick()
          .catch(() => {})
          .finally(() => {
            this.active = undefined;
          });
    }, 1000);
    this.timer.unref();
  }
  private async tick() {
    for (let i = 0; i < 20 && !this.stopping; i++) if (!(await this.folders.processNext())) break;
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }
}
