// Generated from worker/mcp/castProse.ts by tools/generateValidator.ts. Do not edit.
// The plugin runs under bare node with no build step, so the worker's logic ships as plain JS.

const plain = (text) => (text ?? "").replaceAll("`", "").trim();
function parseCastProse(markdown, known) {
  const notes = /* @__PURE__ */ new Map();
  for (const [, name, look, range] of markdown.matchAll(
    /^\| ([a-z]+) \| ([^|]+) \| ([^|]+) \|$/gm
  ))
    if (name && known.has(name))
      notes.set(name, { look: plain(look), range: plain(range) });
  const registers = [];
  for (const [, label, body] of markdown.matchAll(
    /^- \*\*([^*]+)\*\*(.*)$/gm
  )) {
    if (!label) continue;
    const names = [...(body ?? "").matchAll(/`([a-z]+)`/g)].map((match) => match[1]).filter((name) => known.has(name));
    if (names.length === 0) continue;
    registers.push({
      label: label.trim(),
      key: label.trim().toLowerCase(),
      names: new Set(names)
    });
  }
  return { notes, registers };
}
function isSilent(prose, name) {
  return (prose.notes.get(name)?.range ?? "").includes("one drawing");
}
function registersOf(prose, name) {
  return prose.registers.filter((group) => group.names.has(name)).map((group) => group.label);
}
function findRegister(prose, wanted) {
  return prose.registers.find(
    (group) => group.key.startsWith(wanted.toLowerCase())
  );
}
export {
  findRegister,
  isSilent,
  parseCastProse,
  registersOf
};
