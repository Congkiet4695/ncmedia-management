/**
 * Tiện ích dùng chung cho unit test.
 *
 * `jest.Mock.mock.calls` có kiểu `any[][]`, nên đọc tham số trực tiếp sẽ vi phạm
 * `@typescript-eslint/no-unsafe-member-access`. Helper này thu hẹp kiểu một lần
 * tại đây thay vì rải `eslint-disable` khắp các file test.
 *
 * ⚠️ Chỉ dùng trong test — thư mục này được loại khỏi bản build (`tsconfig.build.json`).
 */

/** Đọc tham số thứ `argIndex` của lần gọi thứ `callIndex` với kiểu tường minh. */
export function callArg<T>(mock: jest.Mock, callIndex: number, argIndex: number): T {
  const calls = mock.mock.calls as unknown as unknown[][];
  return calls[callIndex][argIndex] as T;
}

/** Danh sách tham số thứ `argIndex` của TẤT CẢ các lần gọi. */
export function callArgs<T>(mock: jest.Mock, argIndex: number): T[] {
  const calls = mock.mock.calls as unknown as unknown[][];
  return calls.map((call) => call[argIndex] as T);
}
