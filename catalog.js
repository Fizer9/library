const bibleBooks = [
  ['GEN','Бытие','Быт'], ['EXO','Исход','Исх'], ['LEV','Левит','Лев'], ['NUM','Числа','Чис'], ['DEU','Второзаконие','Втор'],
  ['JOS','Иисус Навин','Нав','Иисуса Навина'], ['JDG','Судьи','Суд'], ['RUT','Руфь','Руф'],
  ['1SA','1 Царств','1 Цар'], ['2SA','2 Царств','2 Цар'], ['1KI','3 Царств','3 Цар'], ['2KI','4 Царств','4 Цар'],
  ['1CH','1 Паралипоменон','1 Пар'], ['2CH','2 Паралипоменон','2 Пар'], ['EZR','Ездра','Езд'], ['NEH','Неемия','Неем'],
  ['EST','Есфирь','Есф'], ['JOB','Иов'], ['PSA','Псалтирь','Пс','Псалтырь','Псалом'], ['PRO','Притчи','Притч'],
  ['ECC','Екклесиаст','Еккл'], ['SNG','Песнь песней','Песн'], ['ISA','Исаия','Ис','Исайя'], ['JER','Иеремия','Иер'],
  ['LAM','Плач Иеремии','Плач'], ['EZK','Иезекииль','Иез'], ['DAN','Даниил','Дан'], ['HOS','Осия','Ос'], ['JOL','Иоиль','Иоил'],
  ['AMO','Амос','Ам'], ['OBA','Авдий','Авд'], ['JON','Иона','Ион'], ['MIC','Михей','Мих'], ['NAM','Наум','Наум'],
  ['HAB','Аввакум','Авв'], ['ZEP','Софония','Соф'], ['HAG','Аггей','Агг'], ['ZEC','Захария','Зах'], ['MAL','Малахия','Мал'],
  ['MAT','От Матфея','Матфея','Мф','Матфей'], ['MRK','От Марка','Марка','Мк','Марк'], ['LUK','От Луки','Луки','Лк','Лука'],
  ['JHN','От Иоанна','Иоанна','Ин','Иоанн'], ['ACT','Деяния','Деян'], ['JAS','Иакова','Иак'],
  ['1PE','1 Петра','1 Пет'], ['2PE','2 Петра','2 Пет'], ['1JN','1 Иоанна','1 Ин'], ['2JN','2 Иоанна','2 Ин'], ['3JN','3 Иоанна','3 Ин'],
  ['JUD','Иуды','Иуд'], ['ROM','Римлянам','Рим'], ['1CO','1 Коринфянам','1 Кор'], ['2CO','2 Коринфянам','2 Кор'],
  ['GAL','Галатам','Гал'], ['EPH','Ефесянам','Еф'], ['PHP','Филиппийцам','Флп'], ['COL','Колоссянам','Кол'],
  ['1TH','1 Фессалоникийцам','1 Фес','1 Сол'], ['2TH','2 Фессалоникийцам','2 Фес','2 Сол'], ['1TI','1 Тимофею','1 Тим'], ['2TI','2 Тимофею','2 Тим'],
  ['TIT','Титу','Тит'], ['PHM','Филимону','Флм'], ['HEB','Евреям','Евр'], ['REV','Откровение','Откр','Апокалипсис'],
].map(([id, name, ...aliases], i) => ({id, name, aliases, group: i < 39 ? 'Ветхий Завет' : 'Новый Завет'}));

const church = 'https://www.churchofjesuschrist.org/study/scriptures/';
const editions = {
  bible: {name: 'Библия', subtitle: 'Синодальный перевод', books: bibleBooks},
  bofm: {
    name: 'Книга Мормона', path: 'bofm',
    books: [
      ['1-ne','1 Нефий',22,'1 Неф'], ['2-ne','2 Нефий',33,'2 Неф'], ['jacob','Иаков',7,'Иак'], ['enos','Енос',1], ['jarom','Иаром',1],
      ['omni','Омний',1], ['w-of-m','Слова Мормона',1,'Сл М'], ['mosiah','Мосия',29,'Мос'], ['alma','Алма',63],
      ['hel','Геламан',16,'Гел'], ['3-ne','3 Нефий',30,'3 Неф'], ['4-ne','4 Нефий',1,'4 Неф'], ['morm','Мормон',9,'Морм'],
      ['ether','Ефер',15], ['moro','Мороний',10,'Морон'],
    ],
  },
  dc: {
    name: 'Учение и Заветы', path: 'dc-testament',
    books: [['dc','Учение и Заветы',138,'У и З','УиЗ','УЗ'], ['od','Официальное заявление',2]],
  },
  pgp: {
    name: 'Драгоценная Жемчужина', path: 'pgp',
    books: [
      ['moses','Моисей',8,'Моис'], ['abr','Авраам',5,'Авр'], ['js-m','Джозеф Смит — от Матфея',1,'ДжС—М'],
      ['js-h','Джозеф Смит — История',1,'ДжС—И'], ['a-of-f','Символы веры',1,'Симв веры'], ['fac','Факсимиле Авраама',3],
    ],
  },
};

for (const edition of Object.values(editions)) {
  if (edition.path) {
    edition.books = edition.books.map(([id, name, count, ...aliases]) => ({id, name, count, aliases}));
  }
}

function normalizeName(name) {
  return name.toLowerCase().replaceAll('ё', 'е').replace(/[\u0300-\u036f]/g, '').replace(/[^а-я0-9]/g, '');
}

function parseReference(input, preferredEdition) {
  const match = input.trim().match(/^(.+?)\s+(\d+)(?:[:.]\s*(\d+)(?:\s*[-–—]\s*(\d+))?)?$/u);
  if (!match) return null;
  const [, rawName, chapter, verse, end] = match;
  const name = normalizeName(rawName);
  const order = [preferredEdition, ...Object.keys(editions).filter(id => id !== preferredEdition)];
  for (const edition of order) {
    const book = editions[edition]?.books.find(item => [item.name, ...item.aliases].some(alias => normalizeName(alias) === name));
    if (book) return {edition, book: book.id, chapter: Number(chapter), verse: Number(verse ?? 1), ...(end && {end: Number(end)})};
  }
  return null;
}

function sourceFor(place) {
  const edition = editions[place.edition];
  if (!edition.path) return `https://ebible.org/russyn/${place.book}${String(place.chapter).padStart(2, '0')}.htm#V${place.verse}`;
  const part = place.book === 'fac' ? `abr/fac-${place.chapter}` : `${place.book}/${place.chapter}`;
  const url = new URL(`${church}${edition.path}/${part}`);
  url.searchParams.set('lang', 'rus');
  if (place.book !== 'fac') {
    url.searchParams.set('id', place.end ? `p${place.verse}-p${place.end}` : `p${place.verse}`);
    url.hash = `p${place.verse}`;
  }
  return url.href;
}
