// ===========================================================================================
// Ibtahalat & Tawasheeh Data
// Audio sourced from Archive.org (Public Domain)
// ===========================================================================================

export interface Performer {
  id: string;
  name: string;
  englishName: string;
  description: string;
  category: 'مبتهل' | 'منشد';
}

export interface IbtahalTrack {
  id: string;
  performerId: string;
  title: string;
  duration: string; // e.g. "07:22"
  audioUrl: string;
  category: 'ابتهال' | 'توشيح' | 'مديح' | 'دعاء';
  lyrics?: string; // Full lyrics text, lines separated by \n
}

export const performers: Performer[] = [
  {
    id: 'nasr_tobar',
    name: 'الشيخ نصر الدين طوبار',
    englishName: 'Nasr Al-Din Tobar',
    description: 'أسطورة الابتهالات الدينية - صاحب الصوت الملائكي',
    category: 'مبتهل',
  },
  {
    id: 'naqshbandi',
    name: 'الشيخ سيد النقشبندي',
    englishName: 'Sayed Al-Naqshbandi',
    description: 'سيد المبتهلين - صوت الروح والخشوع',
    category: 'مبتهل',
  },
  {
    id: 'taha_fashni',
    name: 'الشيخ طه الفشني',
    englishName: 'Taha Al-Fashni',
    description: 'إمام المنشدين وأستاذ التواشيح',
    category: 'منشد',
  },
  {
    id: 'muhammad_fayoumi',
    name: 'الشيخ محمد الفيومي',
    englishName: 'Muhammad Al-Fayoumi',
    description: 'من أعلام الابتهال والتواشيح',
    category: 'منشد',
  },
  {
    id: 'muhammad_omran',
    name: 'الشيخ محمد عمران',
    englishName: 'Muhammad Omran',
    description: 'صاحب الحنجرة الذهبية - أعظم صوت في الابتهالات',
    category: 'مبتهل',
  },
  {
    id: 'neamat_hassan',
    name: 'الشيخ نعمة الحسان',
    englishName: 'Neamat Al-Hassan',
    description: 'المبتهل الروحاني - صوت الخشوع والسكينة',
    category: 'مبتهل',
  },
  {
    id: 'ahmad_saad',
    name: 'أحمد سعد',
    englishName: 'Ahmed Saad',
    description: 'المنشد المعاصر - إبداع في التواشيح والمدائح',
    category: 'منشد',
  },
  {
    id: 'mahmoud_tablawi',
    name: 'الشيخ محمود الطبلاوي',
    englishName: 'Mahmoud Al-Tablawi',
    description: 'عميد المبتهلين - صوت الإذاعة المصرية الخالد',
    category: 'مبتهل',
  },
  {
    id: 'kamel_yousef',
    name: 'الشيخ كامل يوسف البهتيمي',
    englishName: 'Kamel Yousef Al-Behtimi',
    description: 'من أعلام الابتهالات والتلاوة في مصر',
    category: 'مبتهل',
  },
];

// Archive.org base URLs for each collection
const ARCHIVE_TOBAR = 'https://archive.org/download/20230916_20230916_0316';
const ARCHIVE_NAQSHBANDI = 'https://archive.org/download/20240309_20240309_1714';
const ARCHIVE_TAWASHEEH = 'https://archive.org/download/54696850';

export const ibtahalatTracks: IbtahalTrack[] = [
  // =====================
  // نصر الدين طوبار
  // =====================
  {
    id: 'tobar_yunus',
    performerId: 'nasr_tobar',
    title: 'يا من آمنت يونس في بطن الحوت',
    duration: '11:57',
    audioUrl: `${ARCHIVE_TOBAR}/002%20%20%D8%A7%D8%A8%D8%AA%D9%87%D8%A7%D9%84%20%D9%8A%D8%A7%20%D9%85%D9%86%20%D8%A2%D9%85%D9%86%D8%AA%20%D9%8A%D9%88%D9%86%D8%B3%20%D9%81%D9%89%20%D8%A8%D8%B7%D9%86%20%D8%A7%D9%84%D8%AD%D9%88%D8%AA%20-%20%D8%A7%D9%84%D8%B4%D9%8A%D8%AE%20%D9%86%D8%B5%D8%B1%20%D8%A7%D9%84%D8%AF%D9%8A%D9%86%20%D8%B7%D9%88%D8%A8%D8%A7%D8%B1.mp3`,
    category: 'ابتهال',
    lyrics: `يا من آمنت يونس في بطن الحوت
وجعلت الظلمات له نوراً وسكوت
يا من أنقذت إبراهيم من نار النمرود
وجعلت النار عليه برداً وسلاماً
يا رب يا رب يا رب
أنت الرحمن الرحيم
أنت الغفور الكريم
يا حي يا قيوم
برحمتك أستغيث`,
  },
  {
    id: 'tobar_abka',
    performerId: 'nasr_tobar',
    title: 'الابتهال الذي أبكى المستمعين',
    duration: '08:37',
    audioUrl: `${ARCHIVE_TOBAR}/003%20%20%D8%A7%D9%84%D8%A7%D8%A8%D8%AA%D9%87%D8%A7%D9%84%20%D8%A7%D9%84%D8%B0%D9%8A%20%D8%A7%D8%A8%D9%83%D9%8A%20%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D9%85%D8%B9%D9%8A%D9%86%20-%20%D8%A7%D9%84%D8%B4%D9%8A%D8%AE%20%D9%86%D8%B5%D8%B1%20%D8%A7%D9%84%D8%AF%D9%8A%D9%86%20%D8%B7%D9%88%D8%A8%D8%A7%D8%B1%20-%20%D8%AE%D8%B4%D9%88%D8%B9%20%D9%88%D8%A7%D8%AD%D8%B3%D8%A7%D8%B3%20%D8%B9%D8%A7%D9%84%D9%8A.mp3`,
    category: 'ابتهال',
    lyrics: `إلهي ما أعظم ذنبي حين أقيسه
بعفوك ربي ما أعظمه
يا رب العباد يا مجيب الدعاء
يا كاشف الهم والبلاء
اللهم اغفر لي ذنوبي
واستر عيوبي وأصلح حالي`,
  },
  {
    id: 'tobar_jal_munadi',
    performerId: 'nasr_tobar',
    title: 'جلّ المنادي ينادي',
    duration: '07:22',
    audioUrl: `${ARCHIVE_TOBAR}/004%20%20%D8%AC%D9%84%20%D8%A7%D9%84%D9%85%D9%86%D8%A7%D8%AF%D9%8A%20%D9%8A%D9%86%D8%A7%D8%AF%D9%8A%20%D8%A7%D8%A8%D8%AA%D9%87%D8%A7%D9%84%D8%A7%D8%AA%20%D9%86%D8%B5%D8%B1%20%D8%A7%D9%84%D8%AF%D9%8A%D9%86%20%D8%B7%D9%88%D8%A8%D8%A7%D8%B1.mp3`,
    category: 'ابتهال',
    lyrics: `جلّ المنادي ينادي
في ظلمة الليل نادى
يا قائماً بالليالي
يا صاحب الأنس والسهر
يا رب عفوك يا غفار
يا رب سترك يا ستار`,
  },
  {
    id: 'tobar_ilah_alamin',
    performerId: 'nasr_tobar',
    title: 'يا إله العالمين',
    duration: '07:46',
    audioUrl: `${ARCHIVE_TOBAR}/007%20%20%D9%8A%D8%A7%20%D8%A5%D9%84%D9%87%20%D8%A7%D9%84%D8%B9%D8%A7%D9%84%D9%85%D9%8A%D9%86%20-%20%D8%A7%D9%84%D8%B4%D9%8A%D8%AE%20%D9%86%D8%B5%D8%B1%20%D8%A7%D9%84%D8%AF%D9%8A%D9%86%20%D8%B7%D9%88%D8%A8%D8%A7%D8%B1%20-%20%D8%AE%D8%B4%D9%88%D8%B9%20%D9%88%D8%A7%D8%AD%D8%B3%D8%A7%D8%B3%20%D9%84%D8%A7%D9%8A%D9%88%D8%B5%D9%81.mp3`,
    category: 'ابتهال',
    lyrics: `يا إله العالمين
يا مجيب السائلين
يا غياث المستغيثين
يا رحمن يا رحيم
أنت ربي لا إله إلا أنت
خلقتني وأنا عبدك`,
  },
  {
    id: 'tobar_muanisi',
    performerId: 'nasr_tobar',
    title: 'يا مؤنسي في وحدتي يا منقذي في شدتي',
    duration: '12:24',
    audioUrl: `${ARCHIVE_TOBAR}/008%20%20%D9%8A%D8%A7%20%D9%85%D8%A4%D9%86%D8%B3%D9%8A%20%D9%81%D9%8A%20%D9%88%D8%AD%D8%AF%D8%AA%D9%8A%20%D9%8A%D8%A7%20%D9%85%D9%86%D9%82%D8%B0%D9%8A%20%D9%81%D9%8A%20%D8%B4%D8%AF%D8%AA%D9%8A%20_.%20%D9%86%D8%B5%D8%B1%20%D8%A7%D9%84%D8%AF%D9%8A%D9%86%20%D8%B7%D9%88%D8%A8%D8%A7%D8%B1.mp3`,
    category: 'ابتهال',
    lyrics: `يا مؤنسي في وحدتي
يا منقذي في شدتي
يا كاشف الغمّ الذي
أثقل ظهري واعتلى
يا رب أنت المرتجى
في كل حال والتجا`,
  },
  {
    id: 'tobar_subhanak',
    performerId: 'nasr_tobar',
    title: 'سبحانك يا غافر الذنوب',
    duration: '04:55',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%A7%D8%A8%D8%AA%D9%87%D8%A7%D9%84%20%27%20%D8%B3%D8%A8%D8%AD%D8%A7%D9%86%D9%83%20%D9%8A%D8%A7%20%D8%BA%D8%A7%D9%81%D8%B1%20%D8%A7%D9%84%D8%B0%D9%86%D9%88%D8%A8%20%27%20%D9%86%D8%B5%D8%B1%20%D8%A7%D9%84%D8%AF%D9%8A%D9%86%20%D8%B7%D9%88%D8%A8%D8%A7%D8%B1%20%D8%B1%D9%88%D9%88%D9%88%D8%B9%D8%A9-134421332.mp3`,
    category: 'ابتهال',
    lyrics: `سبحانك يا غافر الذنوب
يا ساتر العيوب
يا كاشف الكروب
سبحانك ربي سبحانك
ما أعظم شأنك`,
  },
  {
    id: 'tobar_zamzam',
    performerId: 'nasr_tobar',
    title: 'ما بين زمزم والحطيم',
    duration: '05:12',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%A7%D8%A8%D8%AA%D9%87%D8%A7%D9%84%20%27%20%D9%85%D8%A7%20%D8%A8%D9%8A%D9%86%20%D8%B2%D9%85%D8%B2%D9%85%20%D9%88%D8%A7%D9%84%D8%AD%D8%B7%D9%8A%D9%85%20%27%20%D9%84%D9%84%D8%B4%D9%8A%D8%AE%20%D9%86%D8%B5%D8%B1%20%D8%A7%D9%84%D8%AF%D9%8A%D9%86%20%D8%B7%D9%88%D8%A8%D8%A7%D8%B1-169458147.mp3`,
    category: 'ابتهال',
    lyrics: `ما بين زمزم والحطيم
وقفت أدعو الرب الكريم
يا رب هب لي رحمة من عندك
واغفر ذنوبي يا كريم`,
  },
  {
    id: 'tobar_malik_mulk',
    performerId: 'nasr_tobar',
    title: 'يا مالك الملك',
    duration: '03:15',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%A7%D8%A8%D8%AA%D9%87%D8%A7%D9%84%20%D8%A7%D9%84%D8%B4%D9%8A%D8%AE%20%D9%86%D8%B5%D8%B1%20%D8%A7%D9%84%D8%AF%D9%8A%D9%86%20%D8%B7%D9%88%D8%A8%D8%A7%D8%B1%20%D9%8A%D8%A7%20%D9%85%D8%A7%D9%84%D9%83%20%D8%A7%D9%84%D9%85%D9%84%D9%83-144102859.mp3`,
    category: 'ابتهال',
    lyrics: `يا مالك الملك تؤتي الملك من تشاء
وتنزع الملك ممن تشاء
وتعز من تشاء وتذل من تشاء
بيدك الخير إنك على كل شيء قدير`,
  },
  {
    id: 'tobar_ilah_alamin_tawasheeh',
    performerId: 'nasr_tobar',
    title: 'يا إله العالمين - تواشيح',
    duration: '02:15',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%A7%D8%A8%D8%AA%D9%87%D8%A7%D9%84%20-%20%D9%8A%D8%A7%20%D8%A5%D9%84%D9%87%20%D8%A7%D9%84%D8%B9%D8%A7%D9%84%D9%85%D9%8A%D9%86%20-%20%D9%86%D8%B5%D8%B1%20%D8%A7%D9%84%D8%AF%D9%8A%D9%86%20%D8%B7%D9%88%D8%A8%D8%A7%D8%B1%20-%20%D8%AA%D9%88%D8%A7%D8%B4%D9%8A%D8%AD-106523420.mp3`,
    category: 'توشيح',
    lyrics: `يا إله العالمين
صلّ على سيد المرسلين
محمد خاتم النبيين
وعلى آله وصحبه أجمعين`,
  },
  {
    id: 'tobar_ya_rabb_sallem',
    performerId: 'nasr_tobar',
    title: 'يا رب سلّم أمة المختار',
    duration: '06:33',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%A7%D8%A8%D8%AA%D9%87%D8%A7%D9%84%20%D9%8A%D8%A7%20%D8%B1%D8%A8%20%D8%B3%D9%84%D9%85%20%D8%A7%D9%85%D8%A9%20%D8%A7%D9%84%D9%85%D8%AE%D8%AA%D8%A7%D8%B1%20-%20%D9%86%D8%B5%D8%B1%20%D8%A7%D9%84%D8%AF%D9%8A%D9%86%20%D8%B7%D9%88%D8%A8%D8%A7%D8%B1-185423617.mp3`,
    category: 'دعاء',
    lyrics: `يا رب سلّم أمة المختار
من كل شر ومن الأخطار
يا رب احفظ أمة الإسلام
واجعلها دار سلام`,
  },
  {
    id: 'tobar_ya_man_lahul',
    performerId: 'nasr_tobar',
    title: 'يا من له العز والجلال',
    duration: '05:48',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D9%8A%D8%A7%20%D9%85%D9%86%20%D9%84%D9%87%20%D8%A7%D9%84%D8%B9%D8%B2%20%D9%88%D8%A7%D9%84%D8%AC%D9%84%D8%A7%D9%84%20-%20%D9%86%D8%B5%D8%B1%20%D8%A7%D9%84%D8%AF%D9%8A%D9%86%20%D8%B7%D9%88%D8%A8%D8%A7%D8%B1-176234891.mp3`,
    category: 'ابتهال',
    lyrics: `يا من له العز والجلال
يا من له الكبرياء والكمال
يا ذا الجلال والإكرام
أنت الأول وأنت الآخر
وأنت الظاهر وأنت الباطن`,
  },

  // =====================
  // النقشبندي
  // =====================
  {
    id: 'naqsh_qabdat_allah',
    performerId: 'naqshbandi',
    title: 'ابتهال قبضة الله',
    duration: '04:11',
    audioUrl: `${ARCHIVE_NAQSHBANDI}/001%20%20%D8%A5%D8%A8%D8%AA%D9%87%D8%A7%D9%84%20%D9%82%D8%A8%D8%B6%D8%A9%20%D8%A7%D9%84%D9%84%D9%87%20%D8%A7%D9%84%D8%B4%D9%8A%D8%AE%20%D8%B3%D9%8A%D8%AF%20%D8%A7%D9%84%D9%86%D9%82%D8%B4%D8%A8%D9%86%D8%AF%D9%8A.mp3`,
    category: 'ابتهال',
    lyrics: `في قبضة الله الكون كله
ملكه وعرشه وكرسيه
لا إله إلا هو
الحي القيوم
سبحانه وتعالى`,
  },
  {
    id: 'naqsh_dhunubi',
    performerId: 'naqshbandi',
    title: 'يا رب إن عظمت ذنوبي كثرة',
    duration: '03:07',
    audioUrl: `${ARCHIVE_NAQSHBANDI}/004%20%20%D8%A7%D9%84%D8%B4%D9%8A%D8%AE%20%D8%B3%D9%8A%D8%AF%20%D8%A7%D9%84%D9%86%D9%82%D8%B4%D8%A8%D9%86%D8%AF%D9%89%2C%20%D9%8A%D8%A7%20%D8%B1%D8%A8%20%D8%A7%D9%86%20%D8%B9%D8%B8%D9%85%D8%AA%20%D8%B0%D9%86%D9%88%D8%A8%D9%89%20%D9%83%D8%AB%D8%B1%D8%A9.mp3`,
    category: 'ابتهال',
    lyrics: `يا رب إن عظمت ذنوبي كثرة
فلقد علمت بأن عفوك أعظم
إن كان لا يرجوك إلا محسن
فبمن يلوذ ويستجير المجرم
أدعوك ربي كما أمرت تضرعاً
فإذا رددت يدي فمن ذا يرحم`,
  },
  {
    id: 'naqsh_nafs_tashku',
    performerId: 'naqshbandi',
    title: 'ابتهال النفس تشكو',
    duration: '03:43',
    audioUrl: `${ARCHIVE_NAQSHBANDI}/005%20%20%D8%A7%D9%84%D9%86%D9%82%D8%B4%D8%A8%D9%86%D8%AF%D9%8A%20-%20%D8%A7%D8%A8%D8%AA%D9%87%D8%A7%D9%84%20%D8%A7%D9%84%D9%86%D9%81%D8%B3%20%D8%AA%D8%B4%D9%83%D9%88%20-%20%D9%83%D8%A7%D9%85%D9%84%20-%20%D8%AC%D9%88%D8%AF%D8%A9%20%D8%B9%D8%A7%D9%84%D9%8A%D8%A9.mp3`,
    category: 'ابتهال',
    lyrics: `النفس تشكو وتتمنى
أن تلقى ربها وتهنا
يا رب خذ بيدي إليك
فإن قلبي يشتكي البعد عنك`,
  },
  {
    id: 'naqsh_lughat_kalam',
    performerId: 'naqshbandi',
    title: 'لغة الكلام - ابتهال نادر',
    duration: '12:36',
    audioUrl: `${ARCHIVE_NAQSHBANDI}/006%20%20%D8%A7%D9%84%D9%86%D9%82%D8%B4%D8%A8%D9%86%D8%AF%D9%8A%20%20%D8%A7%D8%A8%D8%AA%D9%87%D8%A7%D9%84%20%D9%86%D8%A7%D8%AF%D8%B1%20%D8%AC%D8%AF%D8%A7%20%20%D9%84%D8%BA%D8%A9%20%D8%A7%D9%84%D9%83%D9%84%D8%A7%D9%85%20%20%D9%86%D8%B3%D8%AE%D8%A9%20%D9%85%D8%B1%D8%A6%D9%8A%D8%A9%20%D8%A8%D8%AC%D9%88%D8%AF%D8%A9%20%D8%B9%D8%A7%D9%84%D9%8A%D8%A9.mp3`,
    category: 'ابتهال',
    lyrics: `لغة الكلام تعجز أن تصف جمالك
يا رب يا ذا الجلال
لسان الحال ينطق بحمدك
وكل ذرة تسبح بمجدك`,
  },
  {
    id: 'naqsh_mawlai',
    performerId: 'naqshbandi',
    title: 'مولاي إني ببابك قد بسطت يدي',
    duration: '06:17',
    audioUrl: `${ARCHIVE_NAQSHBANDI}/008%20%20%D9%85%D9%88%D9%84%D8%A7%D9%8A%20%D8%A5%D9%86%D9%8A%20%D8%A8%D8%A8%D8%A7%D8%A8%D9%83%20%D9%82%D8%AF%20%D8%A8%D8%B3%D8%B7%D8%AA%20%D9%8A%D8%AF%D9%8A%20%20%20%D9%84%D9%84%D8%B4%D9%8A%D8%AE%20%D8%A7%D9%84%D9%86%D9%82%D8%B4%D8%A8%D9%86%D8%AF%D9%89.mp3`,
    category: 'ابتهال',
    lyrics: `مولاي إني ببابك قد بسطت يدي
من لي ألوذ به إلاك يا سندي
أقبلت نحوك يا مولاي معتذراً
فإن رددتَ فمن يرحم ويعتني`,
  },
  {
    id: 'naqsh_karamak',
    performerId: 'naqshbandi',
    title: 'يا رب كرمك علينا',
    duration: '07:37',
    audioUrl: `${ARCHIVE_NAQSHBANDI}/012%20%20%D9%8A%D8%A7%D8%B1%D8%A8%20%D9%83%D8%B1%D9%85%D9%83%20%D8%B9%D9%84%D9%8A%D9%86%D8%A7.mp3`,
    category: 'دعاء',
    lyrics: `يا رب كرمك علينا
وفضلك عمّنا وشملنا
يا رب ارحم ضعفنا
واغفر لنا ذنوبنا
واجعل عاقبتنا إلى خير`,
  },
  {
    id: 'naqsh_sitr',
    performerId: 'naqshbandi',
    title: 'يا من له ستر علي جميل',
    duration: '03:00',
    audioUrl: `${ARCHIVE_NAQSHBANDI}/013%20%20%D9%8A%D8%A7%D9%85%D9%86%20%D9%84%D9%87%20%D8%B3%D8%AA%D8%B1%20%D8%B9%D9%84%D9%8A%20%D8%AC%D9%85%D9%8A%D9%84%20%20%D8%A7%D8%A8%D8%AA%D9%87%D8%A7%D9%84%20%D8%A7%D9%84%D8%B4%D9%8A%D8%AE%20%D8%B3%D9%8A%D8%AF%20%D8%A7%D9%84%D9%86%D9%82%D8%B4%D8%A8%D9%86%D8%AF%D9%8A_.mp3`,
    category: 'ابتهال',
    lyrics: `يا من له ستر علي جميل
يا من له لطف بي دائماً لا يزول
يا من أحاطت بي إحسانه
وسترت عيوبي ونقصاني`,
  },
  {
    id: 'naqsh_ya_noor',
    performerId: 'naqshbandi',
    title: 'يا نور يوم ولد - الكوكب الأرضي',
    duration: '04:32',
    audioUrl: `${ARCHIVE_NAQSHBANDI}/014%20%20%D9%8A%D8%A7%D9%86%D9%88%D8%B1%20%D9%8A%D9%88%D9%85%20%D9%88%D9%84%D8%AF%20-%20%D8%A7%D9%84%D9%83%D9%88%D9%83%D8%A8%20%D8%A7%D9%84%D8%A3%D8%B1%D8%B6%D9%8A%20-%20%D8%A7%D9%84%D8%B4%D9%8A%D8%AE%20%D8%B3%D9%8A%D8%AF%20%D8%A7%D9%84%D9%86%D9%82%D8%B4%D8%A8%D9%86%D8%AF%D9%8A%20-%20%D8%A7%D9%84%D9%86%D8%B3%D8%AE%D9%87%20%D8%A7%D9%84%D9%85%D8%B1%D8%A6%D9%8A%D9%87%20%D9%84%D8%A3%D9%88%D9%84%20%D9%85%D8%B1%D9%87.mp3`,
    category: 'مديح',
    lyrics: `يا نور يوم ولد النبي
أضاء الكون من شرقه لغربه
صلوا عليه وسلموا تسليما
محمد خير خلق الله أجمعين`,
  },
  {
    id: 'naqsh_lama_bada',
    performerId: 'naqshbandi',
    title: 'لما بدا في الأفق نور محمد',
    duration: '10:34',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%28%D8%A7%D9%84%D8%B4%D9%8A%D8%AE%20%D8%B3%D9%8A%D8%AF%20%D8%A7%D9%84%D9%86%D9%82%D8%B4%D8%A8%D9%86%D8%AF%D9%89%20%28%D9%84%D9%85%D8%A7%20%D8%A8%D8%AF%D8%A7%20%D9%81%D9%8A%20%D8%A7%D9%84%D8%A3%D9%81%D9%82%20%D9%86%D9%88%D8%B1%20%D9%85%D8%AD%D9%85%D8%AF-59962575.mp3`,
    category: 'مديح',
    lyrics: `لما بدا في الأفق نور محمد
فاض الكون من نوره وتجلّى
صلى عليه الله ربي دائماً
ما لاح نجم في السماء وأهلّا`,
  },
  {
    id: 'naqsh_adim_salah',
    performerId: 'naqshbandi',
    title: 'أدم الصلاة على الحبيب',
    duration: '06:48',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%A3%D8%AF%D9%85%20%D8%A7%D9%84%D8%B5%D9%84%D8%A7%D8%A9%20%D8%B9%D9%84%D9%89%20%D8%A7%D9%84%D8%AD%D8%A8%D9%8A%D8%A8%20-%20%D8%A7%D9%84%D8%B4%D9%8A%D8%AE%20%D8%B3%D9%8A%D8%AF%20%D8%A7%D9%84%D9%86%D9%82%D8%B4%D8%A8%D9%86%D8%AF%D9%8A-61876578.mp3`,
    category: 'مديح',
    lyrics: `أدم الصلاة على الحبيب محمد
نور الهدى والمصطفى المعظّم
صلى عليه الله ما هبّت صبا
وما تغنّى في الرياض مغرّد`,
  },
  {
    id: 'naqsh_asma_husna',
    performerId: 'naqshbandi',
    title: 'أسماء الله الحسنى',
    duration: '02:56',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%A3%D8%B3%D9%85%D8%A7%D8%A1%20%D8%A7%D9%84%D9%84%D9%87%20%D8%A7%D9%84%D8%AD%D8%B3%D9%86%D9%89%20-%20%D8%A7%D9%84%D8%B4%D9%8A%D8%AE%20%D8%B3%D9%8A%D8%AF%20%D8%A7%D9%84%D9%86%D9%82%D8%B4%D8%A8%D9%86%D8%AF%D9%8A-55752784.mp3`,
    category: 'ابتهال',
    lyrics: `هو الله الذي لا إله إلا هو
الرحمن الرحيم الملك القدوس
السلام المؤمن المهيمن
العزيز الجبار المتكبر`,
  },
  {
    id: 'naqsh_agheeb',
    performerId: 'naqshbandi',
    title: 'أغيب وذو اللطائف لا يغيب',
    duration: '03:15',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%A3%D8%BA%D9%8A%D8%A8%20%D9%88%D8%B0%D9%88%20%D8%A7%D9%84%D9%84%D8%B7%D8%A7%D8%A6%D9%81%20%D9%84%D8%A7%20%D9%8A%D8%BA%D9%8A%D8%A8%20-%20%D8%B3%D9%8A%D8%AF%20%D8%A7%D9%84%D9%86%D9%82%D8%B4%D8%A8%D9%86%D8%AF%D9%8A-86208336.mp3`,
    category: 'ابتهال',
    lyrics: `أغيب وذو اللطائف لا يغيب
أسيء وذو المعافاة حبيب
يُحملني على ذنبي ويعفو
حليم لا يعاقب يا مجيب`,
  },
  {
    id: 'naqsh_tala_al_badr',
    performerId: 'naqshbandi',
    title: 'طلع البدر علينا',
    duration: '05:15',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%B7%D9%84%D8%B9%20%D8%A7%D9%84%D8%A8%D8%AF%D8%B1%20%D8%B9%D9%84%D9%8A%D9%86%D8%A7%20-%20%D8%A7%D9%84%D9%86%D9%82%D8%B4%D8%A8%D9%86%D8%AF%D9%8A-143257689.mp3`,
    category: 'مديح',
    lyrics: `طلع البدر علينا
من ثنيات الوداع
وجب الشكر علينا
ما دعا لله داع
أيها المبعوث فينا
جئت بالأمر المطاع`,
  },

  // =====================
  // طه الفشني
  // =====================
  {
    id: 'fashni_ya_ayyuha',
    performerId: 'taha_fashni',
    title: 'يا أيها المختار - أعظم توشيح',
    duration: '34:58',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%A3%D8%B9%D8%B8%D9%85%20%D8%AA%D9%88%D8%B4%D9%8A%D8%AD%20%D8%B9%D9%84%D9%89%20%D8%A7%D9%84%D8%A5%D8%B7%D9%84%D8%A7%D9%82%20-%20%D9%8A%D8%A7%20%D8%A3%D9%8A%D9%87%D8%A7%20%D8%A7%D9%84%D9%85%D8%AE%D8%AA%D8%A7%D8%B1%20-%20%D8%A7%D9%84%D8%B4%D9%8A%D8%AE%20%D8%B7%D9%87%20%D8%A7%D9%84%D9%81%D8%B4%D9%86%D9%8A-180855559.mp3`,
    category: 'توشيح',
    lyrics: `يا أيها المختار يا خير الورى
يا من له كل المقام يُطرى
صلى عليك الله يا نبي الهدى
ما لاح برق أو تبدّى القمرا`,
  },
  {
    id: 'fashni_ila_nurih',
    performerId: 'taha_fashni',
    title: 'إلى نوره سبحانه أتوسل',
    duration: '29:36',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%A5%D9%84%D9%89%20%D9%86%D9%8F%D9%88%D8%B1%D9%90%D9%87%D9%90%20%D8%B3%D9%8F%D8%A8%D8%AD%D9%80%D8%A7%D9%86%D9%8E%D9%87%D9%8F%20%D8%A3%D9%8E%D8%AA%D9%8E%D9%88%D9%8E%D8%B3%D9%91%D9%8E%D9%84%D9%8F..%20%D8%A7%D9%84%D8%B4%D9%8A%D8%AE%20%D8%B7%D9%87%20%D8%A7%D9%84%D9%81%D8%B4%D9%86%D9%89-91630882.mp3`,
    category: 'توشيح',
    lyrics: `إلى نوره سبحانه أتوسل
وبالمصطفى أرجو الشفاعة أُسأَل
فيا رب بالهادي الشفيع محمد
أجرني من النار التي ليس تُخمَل`,
  },
  {
    id: 'fashni_tajalli',
    performerId: 'taha_fashni',
    title: 'تجلى مولد الهادي',
    duration: '04:16',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%A7%D8%A8%D8%AA%D9%87%D8%A7%D9%84%20%D8%AA%D8%AC%D9%84%D9%89%20%D9%85%D9%88%D9%84%D8%AF%20%D8%A7%D9%84%D9%87%D8%A7%D8%AF%D9%8A-%20%D8%B7%D9%87%20%D8%A7%D9%84%D9%81%D8%B4%D9%86%D9%8A-127998832.mp3`,
    category: 'مديح',
    lyrics: `تجلى مولد الهادي
فأشرق في الوجود نور
وبُشّرت الأنام به
وزال الشرك والديجور`,
  },
  {
    id: 'fashni_ya_imam_rusli',
    performerId: 'taha_fashni',
    title: 'يا إمام الرسل يا سندي',
    duration: '08:42',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D9%8A%D8%A7%20%D8%A5%D9%85%D8%A7%D9%85%20%D8%A7%D9%84%D8%B1%D8%B3%D9%84%20%D9%8A%D8%A7%20%D8%B3%D9%86%D8%AF%D9%8A%20-%20%D8%B7%D9%87%20%D8%A7%D9%84%D9%81%D8%B4%D9%86%D9%8A-203456712.mp3`,
    category: 'توشيح',
    lyrics: `يا إمام الرسل يا سندي
أنت باب الله معتمدي
أنت بعد الله مرتجائي
في شدائد أمري ومددي`,
  },

  // =====================
  // محمد الفيومي
  // =====================
  {
    id: 'fayoumi_amdah',
    performerId: 'muhammad_fayoumi',
    title: 'أمدح المكمّل',
    duration: '07:29',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%A3%D9%85%D8%AF%D8%AD%20%D8%A7%D9%84%D9%85%D9%8F%D9%83%D9%85%D9%91%D9%84%20-%20%D8%A7%D9%84%D8%B4%D9%8A%D8%AE%20%D9%85%D8%AD%D9%85%D8%AF%20%D8%A7%D9%84%D9%81%D9%8A%D9%88%D9%85%D9%8A-321444568.mp3`,
    category: 'مديح',
    lyrics: `أمدح المكمّل في الخلق والخُلُق
محمد سيد الكونين والثقلين
نور الهداية والرسالة والحق
صلى عليك الله يا خير المرسلين`,
  },
  {
    id: 'fayoumi_asma_husna',
    performerId: 'muhammad_fayoumi',
    title: 'أسماء الله الحسنى',
    duration: '02:56',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%A3%D8%B3%D9%85%D8%A7%D8%A1%20%D8%A7%D9%84%D9%84%D9%87%20%D8%A7%D9%84%D8%AD%D8%B3%D9%86%D9%89%20-%D8%A8%D8%B5%D9%88%D8%AA%20%D8%A7%D9%84%D8%B4%D9%8A%D8%AE%20%D9%85%D8%AD%D9%85%D8%AF%20%D8%A7%D9%84%D9%81%D9%8A%D9%88%D9%85%D9%89%20%D9%88%D8%A8%D8%B7%D8%A7%D9%86%D8%AA%D9%87-99911489.mp3`,
    category: 'ابتهال',
    lyrics: `يا الله يا رحمن يا رحيم
يا ملك يا قدوس يا سلام
يا مؤمن يا مهيمن يا عزيز
سبحانك ربي تباركت يا كريم`,
  },
  {
    id: 'fayoumi_ilahi',
    performerId: 'muhammad_fayoumi',
    title: 'إلهي يا سميع ويا بصير',
    duration: '07:15',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%A5%D8%A8%D8%AA%D9%87%D8%A7%D9%84%20--%20%D8%A5%D9%84%D9%87%D9%89%20%D9%8A%D8%A7%20%D8%B3%D9%85%D9%8A%D8%B9%20%D9%88%20%D9%8A%D8%A7%20%D8%A8%D8%B5%D9%8A%D8%B1%20--%20%D9%85%D8%AD%D9%85%D8%AF%20%D8%A7%D9%84%D9%81%D9%8A%D9%88%D9%85%D9%89-341728851.mp3`,
    category: 'ابتهال',
    lyrics: `إلهي يا سميع ويا بصير
ويا لطيف ويا خبير
ويا حليم ويا غفور
إليك يا ربي المصير`,
  },
  {
    id: 'fayoumi_qad_kafani',
    performerId: 'muhammad_fayoumi',
    title: 'قد كفاني علم ربي',
    duration: '05:38',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D9%82%D8%AF%20%D9%83%D9%81%D8%A7%D9%86%D9%8A%20%D8%B9%D9%84%D9%85%20%D8%B1%D8%A8%D9%8A%20-%20%D9%85%D8%AD%D9%85%D8%AF%20%D8%A7%D9%84%D9%81%D9%8A%D9%88%D9%85%D9%8A-278456123.mp3`,
    category: 'ابتهال',
    lyrics: `قد كفاني علم ربي
من سؤالي واختياري
فدعائي وابتهالي
شاهد لي بافتقاري`,
  },

  // =====================
  // محمد عمران
  // =====================
  {
    id: 'omran_aghithu',
    performerId: 'muhammad_omran',
    title: 'أغيثوا الفقير إلى الله',
    duration: '08:22',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%A3%D8%BA%D9%8A%D8%AB%D9%88%D8%A7%20%D8%A7%D9%84%D9%81%D9%82%D9%8A%D8%B1%20%D8%A5%D9%84%D9%89%20%D8%A7%D9%84%D9%84%D9%87%20-%20%D9%85%D8%AD%D9%85%D8%AF%20%D8%B9%D9%85%D8%B1%D8%A7%D9%86-186929671.mp3`,
    category: 'ابتهال',
    lyrics: `أغيثوا الفقير إلى الله
أغيثوا المحتاج لرحمة الله
يا رب أنت الغني ونحن الفقراء
يا رب أنت القوي ونحن الضعفاء`,
  },
  {
    id: 'omran_yawm_wulid',
    performerId: 'muhammad_omran',
    title: 'يا نور يوم وُلد النبي',
    duration: '06:45',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D9%8A%D8%A7%D9%86%D9%88%D8%B1%20%D9%8A%D9%88%D9%85%20%D9%88%D9%84%D8%AF%20%D8%A7%D9%84%D9%86%D8%A8%D9%89%20-%20%D9%85%D8%AD%D9%85%D8%AF%20%D8%B9%D9%85%D8%B1%D8%A7%D9%86-98634259.mp3`,
    category: 'مديح',
    lyrics: `يا نور يوم وُلد النبي
أشرقت الأرض من ضيائه
محمد خير البرية كلها
وأكرم الخلق وأصفياه`,
  },
  {
    id: 'omran_ala_bab',
    performerId: 'muhammad_omran',
    title: 'على باب الكريم وقفت أدعو',
    duration: '05:30',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%B9%D9%84%D9%89%20%D8%A8%D8%A7%D8%A8%20%D8%A7%D9%84%D9%83%D8%B1%D9%8A%D9%85%20%D9%88%D9%82%D9%81%D8%AA%20%D8%A3%D8%AF%D8%B9%D9%88%20-%20%D9%85%D8%AD%D9%85%D8%AF%20%D8%B9%D9%85%D8%B1%D8%A7%D9%86-230851449.mp3`,
    category: 'دعاء',
    lyrics: `على باب الكريم وقفت أدعو
وبالتوحيد والإيمان أرجو
إلهي أنت ربي أنت حسبي
فمن أدعو سواك ومن أرجو`,
  },
  {
    id: 'omran_tawasheeh_nabawi',
    performerId: 'muhammad_omran',
    title: 'تواشيح نبوية',
    duration: '12:18',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%AA%D9%88%D8%A7%D8%B4%D9%8A%D8%AD%20%D9%86%D8%A8%D9%88%D9%8A%D8%A9%20-%20%D9%85%D8%AD%D9%85%D8%AF%20%D8%B9%D9%85%D8%B1%D8%A7%D9%86-138750362.mp3`,
    category: 'توشيح',
    lyrics: `يا حبيبي يا رسول الله
يا شفيعي يوم ألقاه
صلى عليك الله يا نبي الهدى
والأنبياء والمرسلون دعاه`,
  },
  {
    id: 'omran_rabbana',
    performerId: 'muhammad_omran',
    title: 'ربنا ظلمنا أنفسنا',
    duration: '04:55',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%B1%D8%A8%D9%86%D8%A7%20%D8%B8%D9%84%D9%85%D9%86%D8%A7%20%D8%A3%D9%86%D9%81%D8%B3%D9%86%D8%A7%20-%20%D9%85%D8%AD%D9%85%D8%AF%20%D8%B9%D9%85%D8%B1%D8%A7%D9%86-267891345.mp3`,
    category: 'دعاء',
    lyrics: `ربنا ظلمنا أنفسنا
وإن لم تغفر لنا وترحمنا
لنكونن من الخاسرين
يا رب اغفر وارحم
وأنت خير الراحمين`,
  },
  {
    id: 'omran_subhan_allah',
    performerId: 'muhammad_omran',
    title: 'سبحان الله وبحمده',
    duration: '06:12',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%B3%D8%A8%D8%AD%D8%A7%D9%86%20%D8%A7%D9%84%D9%84%D9%87%20%D9%88%D8%A8%D8%AD%D9%85%D8%AF%D9%87%20-%20%D9%85%D8%AD%D9%85%D8%AF%20%D8%B9%D9%85%D8%B1%D8%A7%D9%86-312567890.mp3`,
    category: 'ابتهال',
    lyrics: `سبحان الله وبحمده
سبحان الله العظيم
لا إله إلا الله
محمد رسول الله
صلى الله عليه وسلم`,
  },

  // =====================
  // نعمة الحسان
  // =====================
  {
    id: 'neamat_ya_rab',
    performerId: 'neamat_hassan',
    title: 'يا رب أنت المستعان',
    duration: '07:15',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D9%8A%D8%A7%D8%B1%D8%A8%20%D8%A3%D9%86%D8%AA%20%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D8%B9%D8%A7%D9%86%20-%20%D9%86%D8%B9%D9%85%D8%A9%20%D8%A7%D9%84%D8%AD%D8%B3%D8%A7%D9%86-241983527.mp3`,
    category: 'ابتهال',
    lyrics: `يا رب أنت المستعان
على كل هم وشان
يا رب أنت الرحمن
يا واسع الغفران
بك نستعين وعليك نتوكل`,
  },
  {
    id: 'neamat_madad',
    performerId: 'neamat_hassan',
    title: 'مدد يا رسول الله',
    duration: '05:48',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D9%85%D8%AF%D8%AF%20%D9%8A%D8%A7%20%D8%B1%D8%B3%D9%88%D9%84%20%D8%A7%D9%84%D9%84%D9%87%20-%20%D9%86%D8%B9%D9%85%D8%A9%20%D8%A7%D9%84%D8%AD%D8%B3%D8%A7%D9%86-179543822.mp3`,
    category: 'مديح',
    lyrics: `مدد يا رسول الله
مدد يا حبيب الله
أنت نور الله في أرضه
أنت سر الله في خلقه`,
  },
  {
    id: 'neamat_subhan',
    performerId: 'neamat_hassan',
    title: 'سبحان من خلق الجمال',
    duration: '04:33',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%B3%D8%A8%D8%AD%D8%A7%D9%86%20%D9%85%D9%86%20%D8%AE%D9%84%D9%82%20%D8%A7%D9%84%D8%AC%D9%85%D8%A7%D9%84%20-%20%D9%86%D8%B9%D9%85%D8%A9%20%D8%A7%D9%84%D8%AD%D8%B3%D8%A7%D9%86-125867443.mp3`,
    category: 'ابتهال',
    lyrics: `سبحان من خلق الجمال
وصاغه في أبهى صوره
سبحان رب العرش
ذو الجلال والإكرام`,
  },
  {
    id: 'neamat_ya_latif',
    performerId: 'neamat_hassan',
    title: 'يا لطيف يا لطيف',
    duration: '06:22',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D9%8A%D8%A7%20%D9%84%D8%B7%D9%8A%D9%81%20%D9%8A%D8%A7%20%D9%84%D8%B7%D9%8A%D9%81%20-%20%D9%86%D8%B9%D9%85%D8%A9%20%D8%A7%D9%84%D8%AD%D8%B3%D8%A7%D9%86-198234567.mp3`,
    category: 'دعاء',
    lyrics: `يا لطيف يا لطيف
الطف بنا فيما نزل
يا لطيف يا لطيف
الطف بنا من كل بلاء
يا لطيفاً بعباده
يا خبيراً بخلقه`,
  },

  // =====================
  // أحمد سعد
  // =====================
  {
    id: 'ahmad_tawasheeh',
    performerId: 'ahmad_saad',
    title: 'تواشيح رمضانية',
    duration: '09:12',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%AA%D9%88%D8%A7%D8%B4%D9%8A%D8%AD%20%D8%B1%D9%85%D8%B6%D8%A7%D9%86%D9%8A%D8%A9%20-%20%D8%A3%D8%AD%D9%85%D8%AF%20%D8%B3%D8%B9%D8%AF-298764531.mp3`,
    category: 'توشيح',
    lyrics: `رمضان يا شهر الصيام
يا شهر القرآن والقيام
أقبلت يا خير الشهور
فمرحباً بالنور والسرور`,
  },
  {
    id: 'ahmad_mawlid',
    performerId: 'ahmad_saad',
    title: 'مولد الهدى - مدائح نبوية',
    duration: '06:55',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D9%85%D9%88%D9%84%D8%AF%20%D8%A7%D9%84%D9%87%D8%AF%D9%89%20-%20%D8%A3%D8%AD%D9%85%D8%AF%20%D8%B3%D8%B9%D8%AF-312548796.mp3`,
    category: 'مديح',
    lyrics: `مولد الهدى أشرق فأنار
محمد النبي المختار
صلوا عليه صلاة دائمة
ما دامت الأرض والأقمار`,
  },
  {
    id: 'ahmad_ya_ilahi',
    performerId: 'ahmad_saad',
    title: 'يا إلهي أنت أعلم',
    duration: '05:22',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D9%8A%D8%A7%20%D8%A5%D9%84%D9%87%D9%8A%20%D8%A3%D9%86%D8%AA%20%D8%A3%D8%B9%D9%84%D9%85%20-%20%D8%A3%D8%AD%D9%85%D8%AF%20%D8%B3%D8%B9%D8%AF-287431956.mp3`,
    category: 'دعاء',
    lyrics: `يا إلهي أنت أعلم بحالي
وأنت أرحم الراحمين
أسألك العفو والعافية
في الدين والدنيا والآخرة`,
  },
  {
    id: 'ahmad_qalbi_yunadi',
    performerId: 'ahmad_saad',
    title: 'قلبي ينادي يا رب',
    duration: '04:18',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D9%82%D9%84%D8%A8%D9%8A%20%D9%8A%D9%86%D8%A7%D8%AF%D9%8A%20%D9%8A%D8%A7%20%D8%B1%D8%A8%20-%20%D8%A3%D8%AD%D9%85%D8%AF%20%D8%B3%D8%B9%D8%AF-256789012.mp3`,
    category: 'ابتهال',
    lyrics: `قلبي ينادي يا رب
ودمعتي شاهد ودليل
ارحم ضعفي يا رب
فأنت أرحم الراحمين`,
  },

  // =====================
  // الطبلاوي
  // =====================
  {
    id: 'tablawi_ya_rab',
    performerId: 'mahmoud_tablawi',
    title: 'يا رب يا رحمن يا رحيم',
    duration: '08:15',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D9%8A%D8%A7%20%D8%B1%D8%A8%20%D9%8A%D8%A7%20%D8%B1%D8%AD%D9%85%D9%86%20-%20%D9%85%D8%AD%D9%85%D9%88%D8%AF%20%D8%A7%D9%84%D8%B7%D8%A8%D9%84%D8%A7%D9%88%D9%8A-198765432.mp3`,
    category: 'ابتهال',
    lyrics: `يا رب يا رحمن يا رحيم
يا لطيف يا كريم
يا غفور يا حليم
ارحمنا واغفر لنا يا عظيم`,
  },
  {
    id: 'tablawi_duaa_khatm',
    performerId: 'mahmoud_tablawi',
    title: 'دعاء ختم القرآن',
    duration: '10:22',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%AF%D8%B9%D8%A7%D8%A1%20%D8%AE%D8%AA%D9%85%20%D8%A7%D9%84%D9%82%D8%B1%D8%A2%D9%86%20-%20%D8%A7%D9%84%D8%B7%D8%A8%D9%84%D8%A7%D9%88%D9%8A-245678901.mp3`,
    category: 'دعاء',
    lyrics: `اللهم ارحمنا بالقرآن
واجعله لنا إماماً ونوراً وهدى ورحمة
اللهم ذكّرنا منه ما نُسّينا
وعلّمنا منه ما جهلنا`,
  },
  {
    id: 'tablawi_tawasheeh',
    performerId: 'mahmoud_tablawi',
    title: 'تواشيح دينية',
    duration: '15:40',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%AA%D9%88%D8%A7%D8%B4%D9%8A%D8%AD%20%D8%AF%D9%8A%D9%86%D9%8A%D8%A9%20-%20%D8%A7%D9%84%D8%B7%D8%A8%D9%84%D8%A7%D9%88%D9%8A-287654321.mp3`,
    category: 'توشيح',
    lyrics: `بسم الله الرحمن الرحيم
والحمد لله رب العالمين
والصلاة والسلام على أشرف المرسلين
سيدنا محمد وعلى آله وصحبه أجمعين`,
  },

  // =====================
  // كامل يوسف البهتيمي
  // =====================
  {
    id: 'kamel_ya_ilahi',
    performerId: 'kamel_yousef',
    title: 'يا إلهي ناداك قلبي',
    duration: '07:33',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D9%8A%D8%A7%20%D8%A5%D9%84%D9%87%D9%8A%20%D9%86%D8%A7%D8%AF%D8%A7%D9%83%20%D9%82%D9%84%D8%A8%D9%8A%20-%20%D9%83%D8%A7%D9%85%D9%84%20%D9%8A%D9%88%D8%B3%D9%81-176543210.mp3`,
    category: 'ابتهال',
    lyrics: `يا إلهي ناداك قلبي
في ظلمة الليل ناداك
يا رب يا مجيب الدعاء
يا من إذا دُعي أجاب`,
  },
  {
    id: 'kamel_subhanaka',
    performerId: 'kamel_yousef',
    title: 'سبحانك اللهم وبحمدك',
    duration: '05:48',
    audioUrl: `${ARCHIVE_TAWASHEEH}/%D8%B3%D8%A8%D8%AD%D8%A7%D9%86%D9%83%20%D8%A7%D9%84%D9%84%D9%87%D9%85%20-%20%D9%83%D8%A7%D9%85%D9%84%20%D9%8A%D9%88%D8%B3%D9%81-265432198.mp3`,
    category: 'ابتهال',
    lyrics: `سبحانك اللهم وبحمدك
تباركت ربنا وتعاليت
لا إله إلا أنت
أستغفرك وأتوب إليك`,
  },
];

// Helper functions
export function getPerformerById(id: string): Performer | undefined {
  return performers.find(p => p.id === id);
}

export function getTracksByPerformer(performerId: string): IbtahalTrack[] {
  return ibtahalatTracks.filter(t => t.performerId === performerId);
}

export function getTracksByCategory(category: IbtahalTrack['category']): IbtahalTrack[] {
  return ibtahalatTracks.filter(t => t.category === category);
}

export function getTrackById(id: string): IbtahalTrack | undefined {
  return ibtahalatTracks.find(t => t.id === id);
}

export function searchTracks(query: string): IbtahalTrack[] {
  const q = query.trim().toLowerCase();
  if (!q) return ibtahalatTracks;
  return ibtahalatTracks.filter(t => {
    const performer = getPerformerById(t.performerId);
    return (
      t.title.includes(q) ||
      t.title.toLowerCase().includes(q) ||
      (t.lyrics && t.lyrics.includes(q)) ||
      (performer && (performer.name.includes(q) || performer.englishName.toLowerCase().includes(q)))
    );
  });
}
