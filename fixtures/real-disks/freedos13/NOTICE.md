# FreeDOS 1.3 floppy images (test fixtures)

These three images are unmodified copies of disk images from the FreeDOS 1.3 Floppy-Only Edition. They are used only
as read-only test input: Exhume reads them as bytes and never runs anything on them.

| Fixture | Path inside the release zip |
| --- | --- |
| `fd13-720k-dsk01.img` | `720k/x86DSK01.img` |
| `fd13-1200k-dsk01.img` | `120m/x86DSK01.img` |
| `fd13-1440k-boot.img` | `144m/x86BOOT.img` |

- Release: `FD13-FloppyEdition.zip` from
  https://www.ibiblio.org/pub/micro/pc-stuff/freedos/files/distributions/1.3/official/
  (SHA-256 `75a4e11a7fce6f124e20927b3022b4b715a2a3f7324c5f5bfea42d90d80eb072`, as listed in that folder's `verify.txt`).
- The SHA-256 of each image is in `manifest.json`.

## Licenses

The images contain FreeDOS programs that are free software, most of them under the GNU General Public License,
with each package under its own license. The MIT license of Exhume does not apply to these files.

The Floppy-Only Edition does not include source code. The source code of every FreeDOS 1.3 package is published by
the FreeDOS project at https://www.freedos.org/download/ and on the FreeDOS 1.3 CD-ROM and USB release media in the
same ibiblio folder.

## Where the expected results come from

The `files` lists in `manifest.json` were made by mounting each image read-only with the macOS `msdos` file system
driver (`hdiutil attach -readonly`) and hashing every file with `shasum -a 256`. They do not come from Exhume, so a
test that compares Exhume with the manifest is not grading Exhume against itself. The mount reports VFAT long names
in lower case, so compare paths without case. `deletedEntries` were checked against the raw directory bytes (the
mount does not show deleted entries). `note_wordstarFalsePositivesBeforeFix` records how many files Exhume called
WordStar before spec 7; it is a note, not an expected value.
