// better-sqlite3 13.2.0은 타입 정의를 포함하지 않는다(@types 패키지는 승인 표 밖).
// 이 앱이 쓰는 API만 최소로 선언한다. 새 API를 쓰면 여기에 추가한다.
declare module 'better-sqlite3' {
  namespace Database {
    interface RunResult {
      changes: number;
      lastInsertRowid: number | bigint;
    }
    interface Statement {
      run(...params: unknown[]): RunResult;
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    }
    interface Options {
      readonly?: boolean;
      fileMustExist?: boolean;
      timeout?: number;
      /** .node 파일 경로 또는 이미 불러온 addon 객체 */
      nativeBinding?: string | object;
    }
    interface Database {
      readonly name: string;
      readonly open: boolean;
      readonly inTransaction: boolean;
      prepare(sql: string): Statement;
      exec(sql: string): this;
      pragma(source: string, options?: { simple?: boolean }): unknown;
      transaction<F extends (...args: never[]) => unknown>(fn: F): F;
      backup(destination: string): Promise<{ totalPages: number; remainingPages: number }>;
      close(): this;
    }
  }
  const Database: new (filename: string, options?: Database.Options) => Database.Database;
  export = Database;
}
