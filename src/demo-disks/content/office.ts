// Plan for the small-business disk (720K, label OFFICE DEMO).
// Every customer, business and city below is invented. Phones are 555-0100 to 555-0199.

import type { TreeNode } from '../../test-support/fat12/index';
import type { DiskPlan } from '../build';
import {
  OFFICE_CUSTOMER,
  OFFICE_INVOICE,
  OFFICE_INVOICES_DIR,
  OFFICE_LOGO,
  OFFICE_OLDCUST,
  OFFICE_README as OFFICE_README_DATE,
} from './dates';
import { logoToPcx } from './logo';
import type { AuthoredLogo } from './logo';
import { tableToDbf } from './table';
import type { AuthoredTable } from './table';
import { INVOICE_TEXT, OFFICE_README as OFFICE_README_TEXT, asciiBytes } from './readme';

export const OFFICE_LABEL = 'OFFICE DEMO';

/** The live customer table. Dates are YYYYMMDD. */
export const CUSTOMER_TABLE: AuthoredTable = {
  fields: [
    { name: 'CUSTNO', type: 'N', length: 5, decimals: 0 },
    { name: 'NAME', type: 'C', length: 24, decimals: 0 },
    { name: 'CITY', type: 'C', length: 16, decimals: 0 },
    { name: 'PHONE', type: 'C', length: 8, decimals: 0 },
    { name: 'SINCE', type: 'D', length: 8, decimals: 0 },
    { name: 'BALANCE', type: 'N', length: 9, decimals: 2 },
  ],
  rows: [
    ['1001', 'Marguerite Oakhollow', 'Lantern Bay', '555-0104', '19870312', '1250.00'],
    ['1002', 'Ibbetson Rope Works', 'Gull Island', '555-0111', '19870604', '86.40'],
    ['1003', 'Ren\u00e9e Waterford', 'Pin\u00e9haven', '555-0123', '19880119', '0.00'],
    ['1004', 'Tallow & Wick Chandlers', 'Ellis Narrows', '555-0127', '19880830', '412.75'],
    ['1005', 'Jos\u00e9 Quillfeather', 'Lantern Bay', '555-0132', '19881122', '39.90'],
    ['1006', 'Brannock Ferry Office', 'Gull Island', '555-0138', '19890207', '2210.10'],
    ['1007', 'Anselm Pottersby', 'Marrow Cross', '555-0145', '19890515', '0.00'],
    ['1008', 'Dolores N\u00fa\u00f1ez-Hale', 'Pin\u00e9haven', '555-0149', '19890901', '175.25'],
    ['1009', 'Saltmarsh Print Shop', 'Ellis Narrows', '555-0156', '19900118', '640.00'],
    ['1010', 'Wilhelmina Crabtree', 'Marrow Cross', '555-0162', '19900426', '58.00'],
    ['1011', 'Harbor Lamp Society', 'Lantern Bay', '555-0168', '19900713', '305.60'],
    ['1012', 'Thaddeus Pennywhistle', 'Gull Island', '555-0174', '19901020', '0.00'],
    ['1013', 'Mill Race Bakery', 'Marrow Cross', '555-0181', '19910109', '92.15'],
    ['1014', 'Odalys Fenwick', 'Ellis Narrows', '555-0193', '19910322', '1480.30'],
  ],
};

/** An older, smaller table. It is deleted and then overwritten, so it ends up lost. */
const OLD_CUSTOMER_TABLE: AuthoredTable = {
  fields: [
    { name: 'CUSTNO', type: 'N', length: 5, decimals: 0 },
    { name: 'NAME', type: 'C', length: 24, decimals: 0 },
  ],
  rows: [
    ['901', 'Marguerite Oakhollow'],
    ['902', 'Ibbetson Rope Works'],
    ['903', 'Brannock Ferry Office'],
  ],
};

const BACKGROUND = 0;
const FRAME = 1;
const BODY = 2;
const GLASS = 3;
const LINES = 4;

/** A lantern on a dark blue field, 64 by 40 pixels, five colors. Integer arithmetic only. */
export const LOGO: AuthoredLogo = {
  width: 64,
  height: 40,
  palette: [
    [16, 24, 64], // background
    [200, 200, 210], // frame
    [150, 90, 30], // lantern body
    [255, 214, 90], // glass
    [90, 140, 200], // ledger lines
  ],
  pixel(x: number, y: number): number {
    if (x < 2 || x >= 62 || y < 2 || y >= 38) return FRAME;
    // Lantern: x 24..39, y 6..33
    if (x >= 24 && x < 40 && y >= 6 && y < 34) {
      if (y < 9 || y >= 31 || x < 27 || x >= 37) return BODY;
      return GLASS;
    }
    // Ledger lines on both sides, every fourth row.
    if (y % 4 === 0 && ((x >= 6 && x < 20) || (x >= 44 && x < 58))) return LINES;
    return BACKGROUND;
  },
};

export const OFFICE_CUSTOMER_DBF = tableToDbf(CUSTOMER_TABLE);
export const OFFICE_LOGO_PCX = logoToPcx(LOGO);

export function officePlan(): DiskPlan {
  const customer = OFFICE_CUSTOMER_DBF.bytes;
  const logo = OFFICE_LOGO_PCX.bytes;
  const invoice = asciiBytes(INVOICE_TEXT);
  const oldCustomer = tableToDbf(OLD_CUSTOMER_TABLE).bytes;
  const readme = asciiBytes(OFFICE_README_TEXT);

  const children: TreeNode[] = [
    { kind: 'file', name: 'CUSTOMER.DBF', content: customer, modified: OFFICE_CUSTOMER.modified },
    { kind: 'file', name: 'LOGO.PCX', content: logo, modified: OFFICE_LOGO.modified },
    {
      kind: 'directory',
      name: 'INVOICES',
      modified: OFFICE_INVOICES_DIR.modified,
      children: [{ kind: 'file', name: 'INV8903.TXT', content: invoice, modified: OFFICE_INVOICE.modified }],
    },
    {
      kind: 'file',
      name: 'OLDCUST.DBF',
      content: oldCustomer,
      modified: OFFICE_OLDCUST.modified,
      deleted: true,
      placement: { startCluster: 2 },
    },
    { kind: 'file', name: 'README.TXT', content: readme, modified: OFFICE_README_DATE.modified },
  ];

  const sources = new Map<string, Uint8Array>([
    ['/CUSTOMER.DBF', customer],
    ['/LOGO.PCX', logo],
    ['/INVOICES/INV8903.TXT', invoice],
    ['/OLDCUST.DBF', oldCustomer],
    ['/README.TXT', readme],
  ]);

  return { tree: { volumeLabel: OFFICE_LABEL, children }, damage: [], sources };
}
