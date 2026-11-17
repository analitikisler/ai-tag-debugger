// What a tool result or a prompt carries between <captured_data> and </captured_data>: the part recorded from the
// audited site, which the model is told is data. The text itself when it has no such part.
export const captured = (text) => String(text).match(/<captured_data>\n([\s\S]*)\n<\/captured_data>/)?.[1] ?? String(text);
