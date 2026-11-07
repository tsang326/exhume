import { writeWordStar } from '../../test-support/formats/index';
import type { WsParagraph, WsSpan } from '../../test-support/formats/index';

/**
 * Authored WordStar prose for the demo disks. The setting is a made-up ferry office on a made-up island.
 * Every name, place and company here is invented for the demo.
 * Rules kept on purpose so the Markdown stays easy to read: no paragraph starts with a Markdown marker
 * and none holds the Markdown or link characters; no digit groups that look like phone numbers.
 */

function plain(text: string, wrapAt?: number): WsParagraph {
  const spans: WsSpan[] = [{ text }];
  return wrapAt === undefined ? { spans } : { spans, wrapAt };
}

function mixed(spans: WsSpan[], wrapAt?: number): WsParagraph {
  return wrapAt === undefined ? { spans } : { spans, wrapAt };
}

const bold = (text: string): WsSpan => ({ text, styles: ['bold'] });
const underline = (text: string): WsSpan => ({ text, styles: ['underline'] });
const italic = (text: string): WsSpan => ({ text, styles: ['italic'] });
const run = (text: string): WsSpan => ({ text });

/** A WordStar dot command line that the converter turns into a page break rule. */
const PAGE_BREAK: WsParagraph = plain('.PA');

export const CHAPTER1: WsParagraph[] = [
  mixed([bold('Chapter One: The Morning Crossing')]),
  plain(
    'Marta Voss opened the ticket office at half past five, when the harbor was still gray and the gulls had not yet started their daily argument. The stove was cold. The kettle was dented. The ledger lay open on the counter exactly where she had left it the night before, with one line still unfinished.',
  ),
  plain(
    'She wrote the date, then the weather, then the word calm, which was how she began every day that deserved it. Out on the water the Lantern Bay ferry sat low and patient at the pier, her paint worn thin along the rail where a thousand hands had held on.',
  ),
  mixed([
    run('Captain Ellery Brandt came in at six with a newspaper under his arm and a question on his face. '),
    italic('Is the Hollis boy still working the lines?'),
    run(' he asked, and Marta said that he was, and that he was early for once.'),
  ]),
  plain(
    'They drank their tea standing up, the way people do when the work is waiting. Through the window they could see the first passengers gathering at the gate: a woman with a crate of hens, two schoolteachers, a man carrying a cello case as carefully as if it held a sleeping child.',
  ),
  mixed([
    run('At a quarter to seven Marta unlocked the gate and read the rules aloud, as she always did. '),
    bold('No bicycles on the upper deck. No dogs off the leash.'),
    run(' Nobody listened, and she did not mind. The rules were less for the passengers than for her.'),
  ]),
  plain(
    'The crossing to Gull Island took forty minutes in fair weather and nobody remembered how long in foul. Marta stamped each ticket with the little brass die her father had used before her, and each stamp left a small round moon on the paper.',
  ),
  plain(
    'By seven the Lantern Bay was loaded. The horn sounded twice, the ropes came in, and the water between the pier and the hull widened slowly into a road of its own. Marta stood at the window until the ferry was only a shape, and then she turned back to the ledger.',
  ),
  plain(
    'The rest of the morning belonged to paperwork. A freight bill had to be copied twice. A schedule had to be pinned to the board outside, where the wind would take its corners by noon. A boy came in asking whether lost mittens were kept in the office, and Marta opened the drawer of lost things and let him look. There were forty mittens and no pairs.',
  ),
  plain(
    'At ten the sun broke through and laid a bright strip across the counter. Marta moved the ledger into it without thinking, the way a plant leans, and went on writing. It was an ordinary day, and she knew by now how rare those were, and how much of a life was made of them.',
  ),
  plain(
    'Near noon she heard the horn of the returning boat, thin and far, and she put down her pen to listen. Every day it sounded a little different. Today it sounded like someone calling a name across a field, and she could not have said whose.',
  ),
];

export const CHAPTER2: WsParagraph[] = [
  mixed([bold('Chapter Two: A Letter from the Mainland')]),
  plain(
    'The mail came on the noon boat, tied with string, as it had come for forty years. Most days it held bills and seed catalogs. Today it held a long gray envelope addressed to the Harbor Office in a hand Marta did not know.',
  ),
  plain(
    'She set it aside while she sold tickets to a family heading for the fair, and again while she settled a quarrel over a lost umbrella. Only when the afternoon lull came did she slit the flap with the end of a pencil and unfold the single page inside.',
  ),
  mixed([
    run('The letter was from the County Transit Board. It said, in careful and cheerful sentences, that the board had '),
    underline('reviewed the future of the Gull Island route'),
    run(' and would hold a public meeting at the end of the month. It did not say what the board had decided.'),
  ]),
  plain(
    'Marta read it twice. Then she read it a third time, slowly, the way she read tide tables, looking for the line that would tell her which way the water was going to run.',
  ),
  PAGE_BREAK,
  plain(
    'That evening she carried the letter up the hill to the Brandt house, where the captain sat on the porch mending a net that did not need mending. He read the page without a word and handed it back.',
  ),
  mixed([
    italic('They will cut the winter schedule,'),
    run(' he said at last. '),
    italic('Maybe the whole run. Boards like to call that a review.'),
  ]),
  plain(
    'Marta folded the letter along its old creases and put it in her coat. Below them the harbor lights came on one at a time, and the Lantern Bay rocked at her pier like something that had not yet been told.',
  ),
  plain(
    'They talked until the stars were out. By the end of it nothing was settled, except that neither of them intended to let the meeting happen without a good many people in the room.',
  ),
  plain(
    'In the morning Marta pinned a notice to the board outside the ticket office. It said only that there would be a meeting, and where, and when, and that tea would be served. She had learned long ago that tea did more for attendance than any argument, and that a plain notice was worth three clever ones.',
  ),
  plain(
    'By noon the notice had been read by the schoolteachers, the fisherman, the woman with the hens, and a visitor from the mainland who asked whether the island always took its ferry so seriously. Marta told him that the island took everything seriously except itself, and sold him a return ticket.',
  ),
  plain(
    'The Hollis boy was sent round the farms on a bicycle with a stack of handwritten copies. He came back at dusk with mud to the knees and a list of eleven names in his pocket. Eleven households had promised to come, and four of them had promised to bring a neighbor who had not yet been asked.',
  ),
  plain(
    'Marta wrote the number in the ledger beside the weather. Calm, she wrote, and then, underneath, a smaller word that she did not usually write there. Hopeful.',
  ),
  plain(
    'She closed the office at six and walked the length of the pier once more before going home, as she did on any night that mattered. The boards were cold and damp underfoot. At the far end the lamp had not yet been lit, and she stood a while in the last gray light, listening to the water work at the pilings.',
  ),
  plain(
    'There are people who say that a harbor is a place where things end. Marta had always thought the opposite. Everything that mattered to her began there, in the first light, at the first boat, with the first ticket stamped and the first rope let go.',
  ),
];

export const CHAPTER3: WsParagraph[] = [
  mixed([bold('Chapter Three: The Meeting')]),
  plain(
    'The meeting was held in the grange hall on the last Thursday of the month. Folding chairs had been set out in rows, and by seven o clock every one of them was taken. People stood along the walls and sat on the stage steps with their coats in their laps.',
  ),
  plain(
    'Nobody had planned it, but the whole island had come. The schoolteachers sat beside the woman with the hens. The cellist, who turned out to teach music at the mainland college, had brought two students and a borrowed piano stool. Even the Hollis boy had cleaned his boots.',
  ),
  plain(
    'A board member in a gray suit read from a prepared statement about ridership, fuel costs, and the long view. He spoke for twelve minutes without once looking up from the page, and when he finished the room was so quiet that the radiator could be heard ticking in the corner. Then Captain Brandt stood, took off his cap, and asked whether the board had ever crossed to the island in February, in the dark, with a child who had a fever and no other way home.',
    46,
  ),
  plain(
    'The board member said that he had not. The captain said that he would be glad to arrange it. Somebody laughed, and then everybody did, and the sound went out through the open doors and across the grass toward the water.',
  ),
  mixed([
    run('One by one the islanders spoke. The woman with the hens described the market boat. A fisherman described the clinic. Marta, who had not meant to speak at all, found herself on her feet with the ledger in her hands, reading out the number of '),
    bold('crossings'),
    run(' that had been made on the Lantern Bay in the last year without a single day lost to anything but weather.'),
  ]),
  plain(
    'When she sat down her hands were shaking, but the room had changed. The board member was writing something on his pad. The man beside him had stopped looking at his watch.',
  ),
  plain(
    'The board did not decide that night. It rarely does. But as the islanders walked home along the shore road, with flashlights swinging and the harbor wide and dark beside them, Marta thought she could feel the whole island leaning, very slightly, in the right direction.',
  ),
  plain(
    'Behind her the grange hall emptied slowly. Chairs scraped, coats were found, and somebody put out the lamps one by one until only the stage light remained, burning over an empty lectern. The caretaker stood in the doorway with his keys, too polite to hurry anyone and too tired to wait much longer.',
  ),
  plain(
    'On the shore road the talk was low and busy. Two of the fishermen were already arguing about what the board would do. One said that boards never changed their minds. The other said that boards never had to meet the people they were deciding about, and that tonight had been a different kind of evening.',
  ),
  plain(
    'The cellist walked with Marta as far as the pier gate. He told her that he had once played a concert in a hall with three hundred seats, and that it had been quieter than tonight. She asked him why. He said that a quiet audience is one thing and a quiet room that has just decided to care is another.',
  ),
  plain(
    'At the gate he lifted his case in a small salute and went on toward the boat house, where a bed had been made up for him. Marta watched until the dark took him. Then she unlocked the office, lit the stove, and sat for a long time with her coat still on, looking at the ledger and not reading it.',
  ),
  plain(
    'In the morning there was a note under the door. It was written in pencil on the back of a freight bill and it said only: the board member has asked to ride the early boat. Marta read it three times. Then she took down the brass die, polished it on her sleeve, and put on the kettle for two.',
  ),
  plain(
    'The early boat left at six. The board member was waiting at the gate in a coat that was too thin for the weather. Captain Brandt shook his hand, handed him a mug of tea, and said that the first thing to learn about the crossing was that nobody ever stays dry. The board member laughed, a little uncertainly, and stepped aboard.',
  ),
  plain(
    'Out on the water the sun came up behind the island, and for a few minutes the whole bay turned the color of brass. Marta stood at the office window and watched the Lantern Bay go out into it, small and steady, carrying everything she cared about, and she did not once look away.',
  ),
  plain(
    'That evening the ledger had a new line in it. The date, the weather, and then a word she had not expected to write for a long time. Stay.',
  ),
];

/** First draft of a chapter that was later cut. Deleted on the writer disk, graded recovered. */
export const DRAFT1: WsParagraph[] = [
  mixed([bold('Chapter Two (first draft)')]),
  plain(
    'Draft note: this version opens on the noon boat instead of in the office. The mail sack is heavy that day and Marta suspects something before she opens a single envelope. Too much suspicion too early, I think.',
  ),
  plain(
    'The envelope was gray, long, and sealed with a stamp she had not seen before. She turned it over twice. A letter that arrives on a quiet Tuesday and weighs more than it should is never about nothing.',
  ),
  plain(
    'She thought about hiding it in the drawer with the lost tickets and the broken whistle and the photograph of her father at the wheel. She thought about handing it to Ellery unopened and letting him carry the weight of it up the hill. She did neither. She stood at the counter while the noon crowd drained away, and she read.',
  ),
  plain(
    'The board had written four paragraphs and said nothing in any of them. That was the part she would remember later, when the others asked what the letter had said. It had said nothing, very politely, and everyone had understood perfectly.',
  ),
  plain(
    'Note to self: cut the hiding scene. Keep the stamp. Keep the line about weight. Maybe move the gray envelope to the start of the next chapter, where it does less damage.',
  ),
  plain(
    'Scene fragment: after the noon crowd leaves, Marta sweeps the office floor, which does not need sweeping. She finds a button under the bench, a ticket stub from some other year, and a gull feather that has no business being indoors. She keeps the feather. She does not know why. Nobody will ask her to explain it, and that is the best kind of detail.',
  ),
  plain(
    'Scene fragment: Ellery arrives with the afternoon tide and finds her sitting on the counter with the letter in her lap. He does not ask. He puts the kettle on and waits for her to speak, and she does, eventually, in a voice so level that it frightens him more than tears would.',
  ),
  plain(
    'Another note: the captain should not be told on the porch. Tell him in the boat house, with the rain on the roof and the lamp turned low. Rain helps. Rain always helps.',
  ),
  plain(
    'Scene sketch: Marta reads the letter again in the boat house after the captain has gone home. The lamp swings on its chain. She holds the page to the light and sees that the board has used the word review four times and the word decision not once. She decides that the missing word is the whole letter.',
  ),
  plain(
    'Scene sketch: the next morning the schoolteachers ask what the letter said. Marta tells them the truth, which is that it said nothing. The younger teacher says that nothing is the most dangerous thing a letter can say. The older one says that she has taught long enough to agree.',
  ),
  plain(
    'Dialogue to keep: Ellery says, they will want us to be quiet. Marta says, then we had better be loud. Ellery says, loud is not our style. Marta says, nobody has asked us about our style. Good rhythm. Do not touch it.',
  ),
  plain(
    'Dialogue to cut: the long speech about the history of the route. It reads like a plaque. Replace it with one detail, the brass die, and let the reader do the rest of the remembering.',
  ),
  plain(
    'Structural note: the chapter is too long for what happens in it. The letter arrives, the letter is read, the letter is shared. Three beats, nine pages. Aim for five. The gray envelope can carry the weight if I let it. Trim the weather. Trim the second cup of tea. Keep the rain.',
  ),
  plain(
    'Last note before I stop for the night: the chapter needs a better title. The Letter is dull. The Gray Envelope is better. The Silence in the Letter is best, but it gives the ending away, so for now it stays in the margin.',
  ),
];

/** Second draft of a short scene. Deleted on the writer disk, graded partial. */
export const DRAFT2: WsParagraph[] = [
  mixed([bold('Chapter Three (rough scene)')]),
  plain(
    'Rough draft of the hall scene. Not sure about the cello. The cello may be too much. But I like the moment where the man with the instrument case stands up and says nothing, and the room waits for him anyway.',
  ),
  plain(
    'Idea: let the board member have a daughter on the island. Never say so. Let the reader work it out when he looks at the hens woman and then looks away.',
  ),
  plain(
    'Idea: end the chapter with the radiator ticking. Keep the last line short. The island leans, the harbor holds, the lamp on the pier goes on.',
  ),
  plain(
    'Idea: Marta reads the crossings out of the ledger. Count them. Make the count a real number and keep it the same everywhere it appears. Check chapter one for the figure before this goes any further.',
  ),
  plain(
    'Idea: maybe the captain should speak last, not first. People remember the last voice in a room. The first voice only sets the key.',
  ),
  plain(
    'Idea: a short paragraph about the weather outside the grange hall while they talk. Wind from the north, a clear sky, the water in the harbor flat as a plate. Nothing happens in it. That is the point.',
  ),
  plain(
    'Idea: the caretaker with the keys should have a line. Something small and dry. He has seen forty years of meetings in this hall and has opinions about all of them.',
  ),
  plain(
    'Idea: cut the schoolteachers if the scene runs long. They are fond company, but they do not push the story forward.',
  ),
];

/** A short business letter in the same setting. The damaged disk keeps it as the file with the looping chain. */
export const LETTER: WsParagraph[] = [
  mixed([bold('Harbor Office, Gull Island')]),
  plain('Dear members of the County Transit Board,'),
  plain(
    'Thank you for your letter about the future of the Gull Island route. We are glad the board has chosen to hold its meeting in person, and we look forward to showing you the crossing as it is lived.',
  ),
  plain(
    'In the past year the ferry carried schoolchildren, patients, mail, groceries, market stalls and one small orchestra. It carried a cow on one occasion, which we do not wish to repeat. It missed no scheduled crossing for any reason other than weather.',
  ),
  plain(
    'We ask only that the board consider the winter timetable as the island sees it: not as a line in a budget, but as the only road between our homes and everything else. We would be pleased to host any member who wishes to ride the early boat.',
  ),
  plain(
    'Sincerely, Marta Voss and Ellery Brandt, for the people of Gull Island. This letter was typed on the office machine after closing, with the stove lit and the kettle on, and it is a good deal warmer than it reads.',
  ),
  plain(
    'We also wish to say that the people of the island are not against change. They have seen the ferry replaced twice, the pier rebuilt once, and the timetable rewritten more often than anyone can count. What they ask is that the change be made with them, and that the board come and see the water before it decides what to do about it.',
  ),
  plain(
    'We have asked our neighbors to write down, in their own words, what the boat means to them. Forty pages have come in so far. Some are short and some are long. One is a single line from the fisherman, who says that the ferry is the only part of the mainland he has ever trusted.',
  ),
  plain(
    'P.S. A few facts that may help the board in its review. The crossing takes forty minutes in fair weather. The boat carries up to ninety passengers and eleven vehicles. The ticket office opens at half past five and closes when the last boat is in, which on a winter night can be a good deal later than the timetable admits.',
  ),
  plain(
    'P.P.S. The island has one school, one clinic, one grocer and one fire engine, all of which depend on the boat in ways that do not appear on any ridership chart. If the board wishes to see this for itself, the kettle is always on, and the early boat has room.',
  ),
  plain(
    'P.P.P.S. We enclose a copy of the winter timetable, a list of the goods carried in the last quarter, and a drawing of the Lantern Bay made by the youngest pupil at the island school. The pupil asks that the drawing be returned, as it is her best one.',
  ),
];

/** A one-screen memo for the damaged disk. Stays readable after the damage. */
export const MEMO: WsParagraph[] = [
  mixed([bold('Memo: winter schedule')]),
  plain(
    'To all staff: the winter timetable begins on the first Monday of November. The first boat leaves at half past six, the last at five. There is no Sunday crossing unless the harbor master says otherwise.',
  ),
  plain(
    'Please check the lines, the lamps and the stove before opening. Report anything loose to the captain. If the glass is falling, say so out loud so everyone hears it.',
  ),
  plain('Coffee is in the tin under the counter. Please leave the kettle as you found it.'),
];

export function chapter1Bytes(): Uint8Array {
  return writeWordStar(CHAPTER1);
}
export function chapter2Bytes(): Uint8Array {
  return writeWordStar(CHAPTER2);
}
export function chapter3Bytes(): Uint8Array {
  return writeWordStar(CHAPTER3);
}
export function draft1Bytes(): Uint8Array {
  return writeWordStar(DRAFT1);
}
export function draft2Bytes(): Uint8Array {
  return writeWordStar(DRAFT2);
}
export function letterBytes(): Uint8Array {
  return writeWordStar(LETTER);
}
export function memoBytes(): Uint8Array {
  return writeWordStar(MEMO);
}
