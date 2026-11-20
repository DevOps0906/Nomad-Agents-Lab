import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** userData 폴더 안 부트 설정 파일 이름(DB 위치를 DB에 둘 수 없으므로 DB 밖 JSON) */
export const BOOT_CONFIG_FILE_NAME = 'boot_config.json';

const absolutePath = z.string().min(1).refine((p) => path.isAbsolute(p), 'absolute path required');

/** 스키마 버전은 넣지 않는다(정본은 DB의 PRAGMA user_version). */
export const BootConfigSchema = z.object({
  data_dir: absolutePath,
  /** 대기 중 전환: 다음 시작 때 backup API로 이 위치에 복사·검증한 뒤 data_dir로 바꾼다. */
  pending_data_dir: absolutePath.optional(),
});

export type BootConfig = z.infer<typeof BootConfigSchema>;

export type BootConfigRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'corrupt'; readonly detail: string }
  | { readonly kind: 'ok'; readonly config: BootConfig };

export function readBootConfig(file: string): BootConfigRead {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    return { kind: 'corrupt', detail: (error as Error).message };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: 'corrupt', detail: 'invalid JSON' };
  }
  const parsed = BootConfigSchema.safeParse(json);
  if (!parsed.success) return { kind: 'corrupt', detail: 'invalid fields' };
  return { kind: 'ok', config: parsed.data };
}

/** 임시 파일에 쓰고 fsync한 뒤 rename으로 바꾼다. 중간에 실패해도 기존 파일은 그대로 남는다. */
export function writeBootConfig(file: string, config: BootConfig): void {
  const data = `${JSON.stringify(BootConfigSchema.parse(config), null, 2)}\n`;
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file);
  } catch (error) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // 임시 파일 정리 실패는 원래 오류를 가리지 않는다.
    }
    throw error;
  }
}
