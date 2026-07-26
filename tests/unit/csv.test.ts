import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

interface Row {
  name: string;
  amount: number;
  note: string | null;
}

describe("toCsv", () => {
  it("renders a simple header + rows", () => {
    const csv = toCsv<Row>([{ name: "Rice", amount: 200, note: null }], [
      { header: "Name", value: (r) => r.name },
      { header: "Amount", value: (r) => r.amount },
      { header: "Note", value: (r) => r.note },
    ]);

    expect(csv).toBe("Name,Amount,Note\r\nRice,200,");
  });

  it("quotes a field containing a comma, per RFC 4180", () => {
    const csv = toCsv<Row>([{ name: "Rice, Basmati", amount: 200, note: null }], [
      { header: "Name", value: (r) => r.name },
    ]);
    expect(csv).toBe('Name\r\n"Rice, Basmati"');
  });

  it("doubles an embedded quote and wraps the whole field in quotes", () => {
    const csv = toCsv<Row>([{ name: 'The "Best" Rice', amount: 200, note: null }], [
      { header: "Name", value: (r) => r.name },
    ]);
    expect(csv).toBe('Name\r\n"The ""Best"" Rice"');
  });

  it("quotes a field containing a newline so it can't split the row", () => {
    const csv = toCsv<Row>([{ name: "Line1\nLine2", amount: 200, note: null }], [
      { header: "Name", value: (r) => r.name },
    ]);
    expect(csv).toBe('Name\r\n"Line1\nLine2"');
  });

  it("preserves Urdu text verbatim (no corruption, no unnecessary quoting)", () => {
    const csv = toCsv<Row>([{ name: "چاول باسمتی", amount: 200, note: null }], [
      { header: "Name", value: (r) => r.name },
    ]);
    expect(csv).toBe("Name\r\nچاول باسمتی");
  });

  it("does not quote a field that needs no escaping", () => {
    const csv = toCsv<Row>([{ name: "Plain Rice", amount: 200, note: "fine" }], [
      { header: "Name", value: (r) => r.name },
      { header: "Note", value: (r) => r.note },
    ]);
    expect(csv).toBe("Name,Note\r\nPlain Rice,fine");
  });

  it("renders an empty CSV as just the header row for zero rows", () => {
    const csv = toCsv<Row>([], [{ header: "Name", value: (r) => r.name }]);
    expect(csv).toBe("Name");
  });
});
