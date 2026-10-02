// Configuration for app.evnx.dev.
//
// ⚠️ Anything that appears in more than one place, or that will change, is
// imported from here rather than typed at a call site. The marketing repo
// learned this the expensive way: a hardcoded version string sat three
// releases stale on the live site for a month.
//
// Runtime facts about the account — plan, limits, usage — are NOT here. They
// come from the API, because the server is the only thing that knows what it
// will actually enforce.

export * from "./site";
