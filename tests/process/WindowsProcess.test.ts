import { describe, test, expect } from "bun:test";
import { WindowsProcess } from "../../src/server/process/WindowsProcess";

describe.skipIf(process.platform !== "win32")("WindowsProcess", () => {
  const processImpl = new WindowsProcess();

  describe("verifyCommand", () => {
    test("returns null for existing executable in PATH", async () => {
      // 'cmd' should exist on all Windows systems
      const result = await processImpl.verifyCommand("cmd");
      expect(result).toBeNull();
    });

    test("returns error message for non-existent executable", async () => {
      const nonExistentPath = "C:\\nonexistent\\path\\to\\executable.exe";
      const result = await processImpl.verifyCommand(nonExistentPath);
      expect(result).toContain("Executable not found");
      expect(result).toContain(nonExistentPath);
    });

    test("returns error for non-existent command in PATH", async () => {
      const result = await processImpl.verifyCommand("definitely-not-a-real-command-12345");
      expect(result).toContain("Executable not found");
    });
  });
});
