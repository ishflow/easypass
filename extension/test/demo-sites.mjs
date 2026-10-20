// English demo portals for the README screenshots (screenshots.mjs): the same server as SITES (sites.mjs), with
// English page texts. An office that signs in for its clients: a tax portal, e-invoicing, a business bank, payroll.
// Names, IDs and passwords are made up; the IBAN is the standard documentation example.
export const DEMO_SITES = [
  {
    host: 'taxportal.test', name: 'State Tax Portal', lang: 'en', color: '#1E3A8A', userLabel: 'Taxpayer ID', userType: 'text',
    signup: [
      { id: 'phone', label: 'Phone', type: 'tel', value: '+1 555 0142' },
      { id: 'address', label: 'Address', type: 'textarea', value: '12 Harbor Lane, Springfield' },
    ],
    users: [
      { first: 'Olivia', last: 'Bennett', username: '4012553018', password: 'k7Rm-2Vq9-Tx' },
      { first: 'James', last: 'Carter', username: '4019823341', password: 'Pw8-Lake-31' },
      { first: 'Sophia', last: 'Turner', username: '4023317752', password: 'Hq4-Mint-77' },
      { first: 'Liam', last: 'Brooks', username: '4027764109', password: 'Zt6-Rock-12' },
      { first: 'Emma', last: 'Collins', username: '4031190827', password: 'Jd2-Fern-58' },
      { first: 'Noah', last: 'Hayes', username: '4035528463', password: 'Vx9-Dune-40' },
      { first: 'Ava', last: 'Mitchell', username: '4040016695', password: 'Rb3-Wave-66' },
    ],
  },
  {
    host: 'einvoice.test', name: 'e-Invoice Portal', lang: 'en', color: '#0F766E', userLabel: 'Email', userType: 'email',
    signup: [
      { id: 'company', label: 'Company name', value: 'Reed Building Ltd' },
      { id: 'vat', label: 'VAT number', value: 'GB 123 4567 89' },
    ],
    users: [
      { first: 'Olivia', last: 'Bennett', username: 'olivia@bennettdesign.example', password: 'Inv-Olive-204' },
      { first: 'Grace', last: 'Kim', username: 'grace@kimcatering.example', password: 'Inv-Grace-318' },
      { first: 'Henry', last: 'Walsh', username: 'henry@walshmotors.example', password: 'Inv-Henry-527' },
    ],
  },
  {
    host: 'bizbank.test', name: 'Business Bank Online', lang: 'en', color: '#047857', userLabel: 'Customer number', userType: 'text', spa: true,
    signup: [
      { id: 'nid', label: 'National ID number', value: '820415-1234', secret: true },
      { id: 'iban', label: 'IBAN', value: 'DE89 3704 0044 0532 0130 00', secret: true },
    ],
    users: [
      { first: 'Lucas', last: 'Gray', username: '70024587', password: 'Bank-Gray-61' },
      { first: 'Chloe', last: 'Foster', username: '70031122', password: 'Bank-Chloe-29' },
      { first: 'Ethan', last: 'Price', username: '70047790', password: 'Bank-Ethan-83' },
    ],
  },
  {
    host: 'payroll.test', name: 'Payroll Services', lang: 'en', color: '#7C3AED', userLabel: 'Email', userType: 'email', ownEye: 'button',
    signup: [
      { id: 'employees', label: 'Number of employees', type: 'number', value: '12' },
    ],
    users: [
      { first: 'Grace', last: 'Kim', username: 'payroll@kimcatering.example', password: 'Pay-Grace-90' },
      { first: 'Henry', last: 'Walsh', username: 'office@walshmotors.example', password: 'Pay-Henry-15' },
    ],
  },
];
