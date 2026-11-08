// Password comes from stdin to avoid shell history and process arguments.
const bcrypt = require("bcrypt");
let value = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (s) => (value += s));
process.stdin.on("end", async () => {
  const password = value.replace(/\r?\n$/, "");
  if (Buffer.byteLength(password) < 12 || Buffer.byteLength(password) > 72)
    throw new Error("Use 12–72 password bytes.");
  console.log(await bcrypt.hash(password, 12));
});
