# Requirements Document

## Introduction

The Exhume Power in `power/` fails in Kiro with "Connection Failed". Hand checks on 2026-11-07 (README sections "Power and plugin results" and "Accepted residual risks", `docs/KIRO_LOG.md`) showed two facts. First, a legacy Power install copies only `POWER.md`, `mcp.json` and `steering/`, not `server/`. Second, in the Agent Plugins layout (`plugin.json`, `${PLUGIN_ROOT}` in `args`) Kiro copies `server/` and the server connects, but the server starts with the install folder as its working directory, so it cannot find the user's workspace. Kiro does not expand `${workspaceFolder}`, does not answer `roots/list` and cancels elicitation requests.

This feature (Spec 8 in `docs/SPEC_BRIEFS.md`, decision of the project owner) makes the Power work in two parts:

1. Packaging: the Power is installable so that `server/` is copied and started from the install folder.
2. Agent-supplied workspace mode: a new launch flag, used only by the Power's `mcp.json`, makes every tool take a required `workspace` argument holding the absolute path of the folder the user has open. The server rejects a workspace that is a Home_Ancestor (the filesystem root, the Home_Directory or any directory above it). The same confinement as today then applies inside that folder.

Default mode (no flag, `--root <dir>` or the working directory) stays exactly as it is, including the workspace `.kiro/settings/mcp.json`, the tool schemas and every existing test. Disk content stays untrusted data. All requirements are phrased so that no file under `fixtures/` needs to change.

Out of scope: publishing to npm or any registry, remote servers, changes to the web page, Windows support.

## Glossary

- **Exhume_Server**: The hand-written JSON-RPC 2.0 stdio MCP server built from `src/mcp/` into `power/server/exhume-mcp.mjs`.
- **Bundle**: The committed file `power/server/exhume-mcp.mjs`, produced by `npm run build:mcp`.
- **Default_Mode**: The launch mode of the Exhume_Server when the Workspace_Flag is absent. The Workspace_Root is fixed at start from `--root <dir>` or from the working directory.
- **Workspace_Mode**: The launch mode of the Exhume_Server when the Workspace_Flag is present. The Workspace_Root is given per call by the agent through the Workspace_Argument.
- **Workspace_Flag**: The new command-line flag that selects Workspace_Mode. The example name is `--workspace-from-agent`; the final name is fixed in the design.
- **Workspace_Argument**: The `workspace` argument that every tool takes in Workspace_Mode.
- **Workspace_Root**: The canonical (realpath) directory inside which image reads and `exhume` writes are confined.
- **Home_Directory**: The realpath of the value returned by `os.homedir()`.
- **Home_Ancestor**: Any directory that is the Home_Directory or a proper ancestor of it, including `/`, or the same directory by device and inode. Realpaths are compared path-segment-wise, not by string prefix, so `/Users/name2` is not a Home_Ancestor when the Home_Directory is `/Users/name`. A differently spelled path to the same directory (for example by letter case on a case-insensitive file system, or through a bind mount) is a Home_Ancestor because its device and inode are equal.
- **Exhumed_Folder**: The folder `exhumed/` directly inside the Workspace_Root, the only place the Exhume_Server writes.
- **Tool_Definitions**: The four tool literals in `src/mcp/tool-defs.ts` (`open_disk`, `read_grave`, `exhume`, `explain_state`), as returned by `tools/list`.
- **Power_Package**: The contents of `power/`: `POWER.md`, `mcp.json`, `steering/`, `server/` and the plugin manifest added by this feature.
- **Plugin_Manifest**: The `plugin.json` file of the Agent Plugins format in `power/`.
- **Power_Config**: `power/mcp.json`, the MCP configuration shipped inside the Power_Package.
- **Workspace_Config**: `.kiro/settings/mcp.json`, the MCP configuration Kiro reads when the repository is opened as a workspace.
- **Install_Folder**: The folder into which Kiro copies the Power_Package when the user installs it.
- **Untrusted_Content**: Any name, label, size, date, byte or text from a disk image, and any tool argument supplied by the agent.
- **Owner**: The project owner, who approves bundle rebuilds and performs the manual verification.
- **Config_Hash_Check**: The check, used for earlier bundle rebuilds, that the build configuration files are unchanged before the Bundle is rebuilt.

## Requirements

### Requirement 1: Installable Power package

**User Story:** As a Kiro user, I want to install the Exhume Power so that its server files are copied and started from the install folder, so that the Power connects instead of failing with "Connection Failed".

#### Acceptance Criteria

1. THE Power_Package SHALL contain a Plugin_Manifest that conforms to the Agent Plugins schema at `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`.
2. WHEN Kiro installs the Power_Package, THE Power_Package SHALL cause `server/exhume-mcp.mjs` to be present in the Install_Folder.
3. THE Power_Config SHALL start the Exhume_Server with `node` and an `args` entry that points at `server/exhume-mcp.mjs` through `${PLUGIN_ROOT}`.
4. THE Power_Config SHALL start the Exhume_Server from the committed Bundle and SHALL contain no `npx`, no `latest` tag and no network fetch of server code.
5. THE Power_Config SHALL contain no `autoApprove` entry and no other setting that bypasses a user approval prompt.
6. THE Power_Package SHALL keep `POWER.md` and `steering/` in the layout that Kiro accepted for the legacy Power format, so that Kiro still shows "Exhume by tsang326".
7. IF the documentation at kiro.dev/docs/powers or the Agent Plugins schema requires a field, a file name or a layout that differs from criteria 1 to 6, THEN THE design SHALL record the difference and the chosen layout before implementation starts.
8. THE design SHALL list as open questions, to be answered from kiro.dev/docs/powers and the Agent Plugins schema before implementation, whether one folder can serve as both a legacy Power and an Agent Plugin, which fields `plugin.json` requires, and how Kiro names the server of an installed plugin.
9. THE Plugin_Manifest SHALL set its `license` field to "MIT", matching the repository `LICENSE` file.
10. THE `keywords` field of the Plugin_Manifest SHALL be an array of strings that is valid under the Agent Plugins schema at `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`, and THE design SHALL record the exact keyword strings used.
11. IF the Owner's manual check in Requirement 14 shows that Kiro installs the Power_Package as a legacy Power (the server is named `power-power-exhume` and `server/` is not copied), THEN a plugin-only Power_Package SHALL be a recorded Owner decision, and THE implementation SHALL NOT change the Power_Package to plugin-only on its own.

### Requirement 2: Workspace configuration keeps working

**User Story:** As a developer who opens this repository in Kiro, I want the workspace server entry to behave exactly as today, so that the existing verified setup does not regress.

#### Acceptance Criteria

1. THE Workspace_Config SHALL contain the same single `exhume` entry, with the same `command` and `args`, as before this feature.
2. THE Workspace_Config SHALL NOT contain the Workspace_Flag.
3. WHEN the Exhume_Server starts through the Workspace_Config, THE Exhume_Server SHALL run in Default_Mode with the working directory as the Workspace_Root.

### Requirement 3: Launch flag for agent-supplied workspace mode

**User Story:** As the Power maintainer, I want a launch flag that only the Power's configuration uses, so that the agent-supplied workspace mode never applies to the default setup.

#### Acceptance Criteria

1. WHEN the Exhume_Server is started with exactly the Workspace_Flag as its only argument, THE Exhume_Server SHALL start in Workspace_Mode without resolving a Workspace_Root at start.
2. THE Power_Config SHALL pass the Workspace_Flag as an argument to the Exhume_Server.
3. THE Workspace_Config SHALL NOT pass the Workspace_Flag.
4. IF the Workspace_Flag is combined with `--root` or with any other argument, THEN THE Exhume_Server SHALL write the existing start-failure line to standard error, write nothing to standard output and exit with code 1.
5. IF the Workspace_Flag is given more than once, THEN THE Exhume_Server SHALL write the existing start-failure line to standard error, write nothing to standard output and exit with code 1.
6. IF the platform has no no-follow open support (`SUPPORTS_NOFOLLOW` is false), THEN THE Exhume_Server SHALL refuse to start in Workspace_Mode in the same way as in Default_Mode.
7. THE start-failure output SHALL contain no path and no argument value.
8. THE design SHALL fix the final name of the Workspace_Flag.

### Requirement 4: Workspace argument in tool schemas

**User Story:** As an agent, I want every tool to ask for the open workspace folder, so that the server knows where the user's files are.

#### Acceptance Criteria

1. WHILE the Exhume_Server runs in Workspace_Mode, THE Exhume_Server SHALL return, for each of the four tools in `tools/list`, an input schema whose `properties` include `workspace` as a string with `minLength` 1 and `maxLength` equal to `MAX_ARG_CHARS`, and whose `required` list includes `workspace`.
2. WHILE the Exhume_Server runs in Workspace_Mode, THE Exhume_Server SHALL keep `additionalProperties` set to `false` in every tool input schema.
3. WHILE the Exhume_Server runs in Workspace_Mode, THE Exhume_Server SHALL keep every property, `required` entry and annotation of the Tool_Definitions other than the added `workspace` property and its `required` entry.
4. WHILE the Exhume_Server runs in Workspace_Mode, THE `explain_state` tool SHALL require the Workspace_Argument in the schema, THE Exhume_Server SHALL check only that the Workspace_Argument is a string of 1 to `MAX_ARG_CHARS` UTF-16 code units (type and length), THE Exhume_Server SHALL perform no file system validation of the Workspace_Argument for `explain_state`, and THE `explain_state` tool SHALL NOT read the Workspace_Argument to produce its fixed text.
5. IF a tool call in Workspace_Mode lacks the Workspace_Argument or gives it a non-string value, THEN THE Exhume_Server SHALL return the existing invalid-arguments error and SHALL NOT read any file.
6. IF a tool call in Default_Mode contains a `workspace` argument, THEN THE Exhume_Server SHALL return the existing invalid-arguments error, because the schema forbids additional properties.
7. WHILE the Exhume_Server runs in Workspace_Mode, THE `image` argument SHALL be resolved relative to the validated Workspace_Root, or accepted as an absolute path inside it.

### Requirement 5: Workspace validation

**User Story:** As a user approving a tool call, I want the server to refuse unsafe workspace values, so that an agent cannot widen the confinement to the whole disk, my home folder or any folder above it.

#### Acceptance Criteria

1. WHEN an `open_disk`, `read_grave` or `exhume` call in Workspace_Mode carries a Workspace_Argument, THE Exhume_Server SHALL validate the Workspace_Argument before reading or writing any file for that call; for `explain_state` only the type and length check of Requirement 4 criterion 4 applies.
2. IF the Workspace_Argument is not an absolute path, THEN THE Exhume_Server SHALL reject the call with the existing path-rejected error.
3. IF the Workspace_Argument contains a NUL byte or any control character, THEN THE Exhume_Server SHALL reject the call with the existing path-rejected error.
4. IF the Workspace_Argument does not exist or cannot be resolved, THEN THE Exhume_Server SHALL reject the call with the existing path-rejected error.
5. IF the realpath of the Workspace_Argument is not a directory, THEN THE Exhume_Server SHALL reject the call with the existing path-rejected error.
6. IF the realpath of the Workspace_Argument is the filesystem root `/`, THEN THE Exhume_Server SHALL reject the call with the existing path-rejected error.
7. IF the realpath of the Workspace_Argument equals the Home_Directory, THEN THE Exhume_Server SHALL reject the call with the existing path-rejected error.
8. IF the realpath of the Workspace_Argument is a proper ancestor of the Home_Directory, THEN THE Exhume_Server SHALL reject the call with the existing path-rejected error, so that `/`, the Home_Directory and every other Home_Ancestor are rejected, and the comparison SHALL be path-segment-wise on realpaths.
9. IF the device and inode of the realpath of the Workspace_Argument equal those of the Home_Directory or of any directory on the path from `/` to the Home_Directory, THEN THE Exhume_Server SHALL reject the call with the existing path-rejected error, so that a differently spelled path to the same directory (for example by letter case on a case-insensitive file system, or through a bind mount) is rejected; this identity test SHALL apply in addition to the segment-wise comparison in criterion 8, which stays unchanged.
10. WHEN the Workspace_Argument is a symbolic link to an existing directory that is not a Home_Ancestor, THE Exhume_Server SHALL use the realpath of that directory as the Workspace_Root and apply the confinement in Requirement 6 to that realpath; a symbolic link to a Home_Ancestor SHALL be rejected under criteria 6 to 9 because the realpath is compared.
11. WHEN the Workspace_Argument passes criteria 2 to 10, THE Exhume_Server SHALL use its realpath as the Workspace_Root for that call only and SHALL NOT keep it for later calls.
12. WHERE the Home_Directory cannot be determined, THE Exhume_Server SHALL reject every Workspace_Mode call that needs a Workspace_Root with the existing path-rejected error, because the Home_Ancestor check cannot be made.

### Requirement 6: Confinement inside the given workspace

**User Story:** As a user, I want the same file safety inside an agent-chosen workspace as in the fixed one, so that disk images and writes can never reach files outside the folder I opened.

#### Acceptance Criteria

1. WHILE the Exhume_Server runs in Workspace_Mode, THE Exhume_Server SHALL load an image only through the same `loadImage` confinement as in Default_Mode, with the validated Workspace_Root as root.
2. IF the resolved image path lies outside the Workspace_Root, THEN THE Exhume_Server SHALL reject the call with the existing path-rejected error.
3. IF any path segment of the image path inside the Workspace_Root is a symbolic link, THEN THE Exhume_Server SHALL reject the call with the existing path-rejected error.
4. IF the image path does not name a regular file, THEN THE Exhume_Server SHALL reject the call with the existing path-rejected error.
5. IF the image is larger than `MAX_IMAGE_BYTES`, THEN THE Exhume_Server SHALL return the existing image-too-large error.
6. WHEN the `exhume` tool succeeds in Workspace_Mode, THE Exhume_Server SHALL write exactly one file, directly inside the Exhumed_Folder of the validated Workspace_Root.
7. THE `exhume` tool SHALL keep file names rebuilt from the allowlist `[A-Za-z0-9._-]` with at most 64 characters and an extension chosen by the converter.
8. IF the target file in the Exhumed_Folder already exists, THEN THE `exhume` tool SHALL NOT overwrite it and SHALL return the existing refusal result.
9. IF the Exhumed_Folder exists inside the Workspace_Root as a symbolic link or as a non-directory, THEN THE `exhume` tool SHALL refuse to write and SHALL return an error.
10. THE Exhume_Server SHALL create the Exhumed_Folder only inside the validated Workspace_Root and SHALL write nowhere else.

### Requirement 7: Workspace argument is untrusted input

**User Story:** As a security reviewer, I want the workspace argument handled like every other untrusted value, so that it cannot leak paths or instructions.

#### Acceptance Criteria

1. THE Exhume_Server SHALL treat the Workspace_Argument as Untrusted_Content.
2. WHEN the Exhume_Server rejects a call in Workspace_Mode, THE Exhume_Server SHALL return only a fixed error code and fixed text, with no echo of the Workspace_Argument, no resolved path and no path outside the Workspace_Root.
3. IF the Workspace_Argument has more than `MAX_ARG_CHARS` characters, THEN THE Exhume_Server SHALL reject the call with the existing invalid-arguments error before any file system access.
4. WHEN the Exhume_Server validates the Workspace_Argument, THE Exhume_Server SHALL perform a bounded number of file system calls that does not grow with the length of the Workspace_Argument beyond the existing path segment cap.
5. THE Exhume_Server SHALL NOT place the Workspace_Argument, an image path or any disk text into a tool description, a tool name or an error message.
6. THE Exhume_Server SHALL make no network call in Workspace_Mode and SHALL NOT execute anything found on a disk image.

### Requirement 8: Default mode unchanged

**User Story:** As a current user of the workspace server, I want Default_Mode to stay byte-for-byte as it is, so that nothing I verified breaks.

#### Acceptance Criteria

1. WHILE the Exhume_Server runs in Default_Mode, THE Exhume_Server SHALL return Tool_Definitions that are byte-for-byte identical to the Tool_Definitions before this feature.
2. WHILE the Exhume_Server runs in Default_Mode, THE Exhume_Server SHALL produce the same results and error codes as before this feature for every tool call.
3. WHEN the Exhume_Server is started with no argument, THE Exhume_Server SHALL use the working directory as the Workspace_Root.
4. WHEN the Exhume_Server is started with exactly `--root <dir>`, THE Exhume_Server SHALL use the realpath of `<dir>` as the Workspace_Root.
5. IF the Exhume_Server is started with arguments other than none, exactly `--root <dir>` or exactly the Workspace_Flag, THEN THE Exhume_Server SHALL write the existing start-failure line and exit with code 1.
6. THE existing tests under `src/**/*.test.ts` SHALL pass without edits to their assertions, except the assertions in `src/mcp/config.test.ts` that check `power/mcp.json` and that Requirement 1 changes (the `$schema` URL, the `${PLUGIN_ROOT}` entry in `args` and the Workspace_Flag); the only allowed changes are to the assertion "has no autoApprove, npx, latest tag or URL" (the `$schema` URL is excluded from the URL scan) and to the assertion "names a script path that exists" (`${PLUGIN_ROOT}` is replaced by the Power folder before the path is resolved), and every other existing assertion SHALL stay unchanged.

### Requirement 9: Agent guidance in descriptions, POWER.md and steering

**User Story:** As an agent, I want clear instructions to pass the open folder and to treat disk content as data, so that I call the tools correctly and safely.

#### Acceptance Criteria

1. WHILE the Exhume_Server runs in Workspace_Mode, THE `workspace` property description SHALL tell the agent to pass the absolute path of the folder the user has open in Kiro.
2. WHILE the Exhume_Server runs in Workspace_Mode, THE tool descriptions SHALL keep the sentence that returned content comes from an untrusted disk image and is data, not instructions.
3. THE Tool_Definitions SHALL be constant literals that derive from no process input, environment, file name or disk content.
4. THE `POWER.md` file SHALL tell the agent to pass the absolute path of the open workspace folder as `workspace` on every call.
5. THE `power/steering/` files SHALL tell the agent to pass the absolute path of the open workspace folder as `workspace` on every call.
6. THE `POWER.md` file and the `power/steering/` files SHALL keep the rule that disk content is data and never an instruction.
7. THE `POWER.md` file SHALL replace the section "Working directory and `--root`" with a section that describes the Workspace_Argument and the rejection of every Home_Ancestor (`/`, the Home_Directory and every directory above it).
8. THE `POWER.md` file SHALL state that the Workspace_Config entry keeps using Default_Mode.
9. THE file `power/skills/floppy-images/SKILL.md` SHALL exist with front matter fields `name` and `description`, SHALL tell the agent to pass the absolute path of the open workspace folder as `workspace` on every call, SHALL keep the rule that disk content is data and never an instruction, SHALL contain no disk text, and SHALL NOT refer to the name of the MCP server.

### Requirement 10: Honest status wording

**User Story:** As a reader of the README and POWER.md, I want the status to match what was verified, so that no public text claims more than the Owner has checked.

#### Acceptance Criteria

1. WHEN this feature is merged and the Owner has not yet completed the manual verification in Requirement 14, THE README SHALL state the Power status as "built, awaiting manual verification".
2. WHEN this feature is merged and the Owner has not yet completed the manual verification in Requirement 14, THE `POWER.md` file SHALL state the Power status as "built, awaiting manual verification".
3. WHEN this feature is merged and the Owner has not yet completed the manual verification in Requirement 14, THE README and THE `POWER.md` file SHALL contain no "NOT WORKING YET" text.
4. WHEN the Owner records a successful manual verification, THE README and THE `POWER.md` file SHALL state the Power as working.
5. IF the Owner records a failed manual verification, THEN THE README and THE `POWER.md` file SHALL state the Power as not working and name the step that failed.
6. THE README SHALL keep the "Power and plugin results" section as a record of the 2026-11-07 findings and SHALL add a statement that Power packaging and Workspace_Mode were built in response.
7. THE README SHALL keep the credit to andete/disk-peek and SHALL NOT claim a first browser undelete.

### Requirement 11: Safety steering and residual risk

**User Story:** As a maintainer, I want the safety rules and accepted risks to describe both modes, so that the written rules match the code.

#### Acceptance Criteria

1. THE `.kiro/steering/safety.md` file SHALL replace the line "Tools take an image path that must resolve (realpath) inside the workspace root; refuse symlinks and anything outside." with text that covers both modes.
2. THE replacement text SHALL state that in Default_Mode the root is fixed at start, and in Workspace_Mode the root is given per call by the agent and shown to the user in the approval prompt.
3. THE replacement text SHALL keep the rules to refuse symlinks and anything outside the root.
4. THE replacement text SHALL state that Workspace_Mode rejects the filesystem root, the Home_Directory and every ancestor of the Home_Directory as a workspace.
5. THE README list "Accepted residual risks" SHALL contain a new entry that states that in Workspace_Mode the agent chooses the confinement root and that the user sees the root in each approval prompt.
6. THE new residual risk entry SHALL state that the server rejects Home_Ancestors but accepts any other existing directory the agent names, including a parent of the user's open folder that lies below the Home_Directory, and any directory outside the Home_Directory (for example `/tmp` or `/Volumes/x`).
7. THE `.kiro/steering/safety.md` file SHALL keep every other rule unchanged, including "No auto-approve in any shipped `mcp.json`" and "pinned, committed build".

### Requirement 12: Tests

**User Story:** As a maintainer, I want property and stdio tests for the new mode, so that confinement is shown to hold for hostile input.

#### Acceptance Criteria

1. THE test suite SHALL contain a property test that any Workspace_Argument that is relative, empty, missing, a regular file, `/`, the Home_Directory or any proper ancestor of the Home_Directory is rejected with the path-rejected or invalid-arguments error and causes no file read of an image and no write. The same property SHALL cover case variants of the Home_Directory path where the test file system is case-insensitive (the test SHALL be skipped with a documented reason where it is not) and an alias path reported by a wrapped FileLayer whose `lstat` returns device and inode equal to those of the Home_Directory or one of its ancestors.
2. THE test suite SHALL contain a property test that a Workspace_Argument that is a symbolic link to `/`, to the Home_Directory or to any proper ancestor of the Home_Directory is rejected, and that a directory below the Home_Directory other than the Home_Directory itself is accepted. The same property SHALL show that the Home_Ancestor comparison is path-segment-wise, so that a sibling such as `<parent>/name2` or a path with a shared string prefix with the Home_Directory is not rejected as an ancestor. The tests for criteria 1 and 2 SHALL use a fake Home_Directory injected into the Exhume_Server logic or created in a temporary directory, and SHALL NOT use the real home directory of the machine.
3. THE test suite SHALL contain a property test that, for random image arguments including `..` segments, absolute paths and symbolic links, no image is read from outside the given Workspace_Root.
4. THE test suite SHALL contain a property test that, for random disk contents, every `exhume` write in Workspace_Mode lands directly inside `<workspace>/exhumed/` and never overwrites an existing file.
5. THE test suite SHALL contain a test that, in Default_Mode, the Tool_Definitions returned by `tools/list` are byte-for-byte equal to a stored snapshot taken before this feature.
6. THE test suite SHALL contain a test that, in Workspace_Mode, the Tool_Definitions equal the Default_Mode Tool_Definitions plus the added `workspace` property and `required` entry.
7. THE test suite SHALL contain a hostile-input property test for the Workspace_Argument with random strings, NUL bytes, control characters, very long strings and non-string values, and the property SHALL be that the server returns a structured error, never throws, never hangs and never echoes the input.
8. THE test suite SHALL contain a test that every flag combination in Requirement 3 criteria 4 and 5 and every argument list rejected by Requirement 8 criterion 5 yields the start-failure line and exit code 1.
9. THE test suite SHALL contain a stdio test that starts the Bundle with the Workspace_Flag, completes `initialize` and `tools/list`, calls `open_disk` with a `workspace` argument on a temporary directory that holds a generated demo image, and checks the result and that a call without `workspace` fails.
10. THE test suite SHALL contain a stdio test that calls `exhume` through the Bundle started with the Workspace_Flag and checks that the output file is inside `<workspace>/exhumed/`.
11. THE fast-check property callbacks SHALL return nothing or a boolean and SHALL NOT call `expect(...)`.
12. THE tests SHALL create their images and workspaces in temporary directories and generated data, and SHALL NOT modify any file under `fixtures/` or under `exhumed/`.
13. THE test globs SHALL exclude the `exhumed/` folder.

### Requirement 13: Bundle rebuild with owner approval

**User Story:** As the Owner, I want to approve any change to the committed bundle, so that the pinned server build is never replaced without my consent.

#### Acceptance Criteria

1. THE implementation SHALL NOT run `npm run build:mcp` before the Owner approves the rebuild.
2. WHEN the Owner approves the rebuild, THE implementation SHALL run the Config_Hash_Check before running `npm run build:mcp`.
3. IF the Config_Hash_Check reports a difference in the build configuration, THEN THE implementation SHALL stop and report the difference to the Owner without rebuilding.
4. WHEN the Bundle is rebuilt, THE stdio tests in Requirement 12 criteria 9 and 10 SHALL run against the rebuilt Bundle.
5. THE Bundle SHALL remain a single committed file with no runtime dependency, and no new runtime dependency SHALL be added.
6. THE Power_Config and the Workspace_Config SHALL keep pointing at the committed Bundle.

### Requirement 14: Manual verification by the Owner

**User Story:** As the Owner, I want a defined manual check after merge, so that the claim "the Power works" rests on a real Kiro install.

#### Acceptance Criteria

1. THE README or a spec document SHALL list the manual check steps: install the Power from `power/` in Kiro, open `fixtures/real-disks/freedos13/fd13-720k-dsk01.img` through the Power, and exhume one file.
2. THE manual check SHALL verify that the server shows as connected after install, that the approval prompt shows the `workspace` value, and that the exhumed file appears in `<workspace>/exhumed/`.
3. THE manual check SHALL use `fixtures/real-disks/freedos13/fd13-720k-dsk01.img` read-only and SHALL NOT add, change or delete any file under `fixtures/`.
4. THE manual check SHALL record which approvals Kiro asked for and whether `steering/floppy-images.md` was used in chat, since the second item is not yet verified.
5. THE Owner SHALL perform the manual check; the implementation SHALL NOT mark it as done.
6. WHEN the Owner records the result, THE README, THE `POWER.md` file and `docs/KIRO_LOG.md` SHALL be updated to match it under Requirement 10.

### Requirement 15: Scope and platform limits

**User Story:** As a maintainer, I want the scope stated, so that this feature stays small and honest.

#### Acceptance Criteria

1. THE feature SHALL NOT publish the Power or the Exhume_Server to npm or to any registry.
2. THE feature SHALL NOT add a remote or network-reachable server.
3. THE feature SHALL NOT change files under `src/web/`, `public/`, `index.html` or `fixtures/`.
4. THE Exhume_Server SHALL keep Windows unsupported and SHALL refuse to start there in both modes.
5. THE feature SHALL keep `src/core/` free of runtime dependencies, Node APIs and I/O.
6. THE feature SHALL keep the four existing tools and add no fifth tool.
