export interface ReciterStyle {
  id: string;
  name: string;
  arabicName: string;
}

export interface Reciter {
  id: string;
  name: string;
  englishName: string;
  style: 'مرتل' | 'مجود' | 'ترتيل' | 'حفص' | 'ورش' | 'قالون';
  description?: string;
  server: string;
  subfolder?: string;
  /** @deprecated legacy source metadata; not used for alignment or rendering. */
  quranFoundationId?: number;
  everyAyahSubfolder?: string;
  /** QUA v2.2.0 timing package slug; the resolver supplies its matching audio URL. */
  quranUniversalSlug?: string;
  isOpenLicense?: boolean;
  moshafId?: number;
  previewSurah?: number;
}

export const recitationStyles: ReciterStyle[] = [
  { id: 'murattal', name: 'Murattal', arabicName: 'مرتل' },
  { id: 'mujawwad', name: 'Mujawwad', arabicName: 'مجود' },
  { id: 'tarteel', name: 'Tarteel', arabicName: 'ترتيل' },
  { id: 'hafs', name: 'Hafs', arabicName: 'حفص' },
  { id: 'warsh', name: 'Warsh', arabicName: 'ورش' },
  { id: 'qaloon', name: 'Qaloon', arabicName: 'قالون' },
];

// ===========================================================================================
// VERIFIED Quran Foundation chapter_recitations IDs:
//   1 = AbdulBaset AbdulSamad (Mujawwad)
//   2 = AbdulBaset AbdulSamad (Murattal)
//   3 = Abdur-Rahman as-Sudais
//   4 = Abu Bakr al-Shatri
//   5 = Hani ar-Rifai
//   6 = Mahmoud Khalil Al-Husary
//   7 = Mishari Rashid al-Afasy
//   8 = Mohamed Siddiq al-Minshawi (Mujawwad)
//   9 = Mohamed Siddiq al-Minshawi (Murattal)
//  10 = Sa'ud ash-Shuraym
//  11 = Mohamed al-Tablawi
//  12 = Mahmoud Khalil Al-Husary (Muallim)
// ===========================================================================================

export const reciters: Reciter[] = [
  // =====================
  // مرتل - Murattal Style
  // =====================
  {
    id: "mishary_alafasy",
    name: "مشاري راشد العفاسي",
    englishName: "Mishary Rashid Alafasy",
    style: "مرتل",
    description: "تلاوة مرتلة خاشعة - الأكثر شهرة",
    server: "https://server8.mp3quran.net/afs",
    quranFoundationId: 7,
    everyAyahSubfolder: "Alafasy_128kbps",
    quranUniversalSlug: 'mishary_rashid_al_afasy_mp3quran',
    isOpenLicense: true,
    moshafId: 1,
  },
  {
    id: "abdul_basit_murattal",
    name: "عبد الباسط عبد الصمد",
    englishName: "Abdul Basit Abdul Samad",
    style: "مرتل",
    description: "تلاوة مرتلة كلاسيكية",
    server: "https://server8.mp3quran.net/basit",
    quranFoundationId: 2,
    // quran-align release-2016-11-24 is paired with this exact EveryAyah
    // source folder; keeping the folder unchanged would invalidate timings.
    everyAyahSubfolder: "Abdul_Basit_Murattal_64kbps",
    quranUniversalSlug: 'abdulbasit_abdulsamad_tarteel',
    isOpenLicense: true,
    moshafId: 5,
  },
  {
    id: "mahmoud_husary_murattal",
    name: "محمود خليل الحصري",
    englishName: "Mahmoud Khalil Al-Husary",
    style: "مرتل",
    description: "شيخ عموم المقارئ المصرية - تلاوة مرتلة متقنة",
    server: "https://server13.mp3quran.net/husr",
    quranFoundationId: 6,
    // Exact source identity for the pinned quran-align timing release.
    everyAyahSubfolder: "Husary_64kbps",
    quranUniversalSlug: 'mahmoud_khalil_al_husary_mp3quran',
    isOpenLicense: true,
    moshafId: 2,
  },
  {
    id: "minshawi_murattal",
    name: "محمد صديق المنشاوي",
    englishName: "Muhammad Siddiq Al-Minshawi",
    style: "مرتل",
    description: "الصوت الباكي الخاشع - المصحف المرتل",
    server: "https://server10.mp3quran.net/minsh",
    quranFoundationId: 9,
    everyAyahSubfolder: "Minshawy_Murattal_128kbps",
    quranUniversalSlug: 'mohammed_siddiq_al_minshawi_mp3quran',
    isOpenLicense: true,
    moshafId: 3,
  },
  {
    id: "maher_muaiqly",
    name: "ماهر المعيقلي",
    englishName: "Maher Al Muaiqly",
    style: "مرتل",
    description: "إمام الحرم المكي",
    server: "https://server12.mp3quran.net/maher",
    everyAyahSubfolder: "MaherAlMuaiqly128kbps",
    quranUniversalSlug: 'maher_al_muaiqly_qdc',
    isOpenLicense: true,
    moshafId: 6,
  },
  {
    id: "saud_shuraim",
    name: "سعود الشريم",
    englishName: "Saud Al-Shuraim",
    style: "مرتل",
    description: "إمام الحرم المكي",
    server: "https://server7.mp3quran.net/shur",
    quranFoundationId: 10,
    everyAyahSubfolder: "Saood_ash-Shuraym_128kbps",
    quranUniversalSlug: 'saud_al_shuraim_mp3quran',
    isOpenLicense: true,
    moshafId: 7,
  },
  {
    id: "abdul_rahman_sudais",
    name: "عبد الرحمن السديس",
    englishName: "Abdul Rahman Al-Sudais",
    style: "مرتل",
    description: "إمام الحرم المكي",
    server: "https://server11.mp3quran.net/sds",
    quranFoundationId: 3, // FIXED: was 4 (Abu Bakr al-Shatri)
    everyAyahSubfolder: "Abdurrahmaan_As-Sudais_192kbps",
    isOpenLicense: true,
    moshafId: 8,
  },
  {
    id: "abu_bakr_shatri",
    name: "أبو بكر الشاطري",
    englishName: "Abu Bakr Al-Shatri",
    style: "مرتل",
    description: "تلاوة خاشعة مميزة ومحبوبة",
    server: "https://server11.mp3quran.net/shatri",
    quranFoundationId: 4,
    everyAyahSubfolder: "Abu_Bakr_Ash-Shaatree_128kbps",
    quranUniversalSlug: 'abu_bakr_al_shatri_tarteel',
    isOpenLicense: true,
    moshafId: 1,
  },
  {
    id: "saad_ghamdi",
    name: "سعد الغامدي",
    englishName: "Saad Al-Ghamdi",
    style: "مرتل",
    description: "تلاوة هادئة مميزة",
    server: "https://server7.mp3quran.net/s_gmd",
    everyAyahSubfolder: "Ghamadi_40kbps",
    isOpenLicense: true,
    moshafId: 9,
  },
  {
    id: "ahmad_ajmi",
    name: "أحمد بن علي العجمي",
    englishName: "Ahmad Al-Ajmi",
    style: "مرتل",
    description: "تلاوة خاشعة مؤثرة",
    server: "https://server10.mp3quran.net/ajm",
    everyAyahSubfolder: "Ahmed_ibn_Ali_al-Ajamy_128kbps_ketaballah.net",
    isOpenLicense: true,
    moshafId: 10,
  },
  {
    id: "hani_rifai",
    name: "هاني الرفاعي",
    englishName: "Hani Al-Rifai",
    style: "مرتل",
    description: "تلاوة مميزة وخاشعة",
    server: "https://server8.mp3quran.net/hani",
    quranFoundationId: 5,
    everyAyahSubfolder: "Hani_Rifai_192kbps",
    isOpenLicense: true,
    moshafId: 11,
  },
  {
    id: "fares_abbad",
    name: "فارس عباد",
    englishName: "Fares Abbad",
    style: "مرتل",
    description: "تلاوة هادئة مؤثرة",
    server: "https://server8.mp3quran.net/frs_a",
    everyAyahSubfolder: "Fares_Abbad_64kbps",
    isOpenLicense: true,
    moshafId: 12,
  },
  {
    id: "yasser_dosari",
    name: "ياسر الدوسري",
    englishName: "Yasser Al-Dosari",
    style: "مرتل",
    description: "تلاوة خاشعة جميلة",
    server: "https://server11.mp3quran.net/yasser",
    quranFoundationId: 97, // Quran Foundation / QDC chapter recitations ID
    everyAyahSubfolder: "Yasser_Ad-Dussary_128kbps",
    isOpenLicense: true,
    moshafId: 13,
  },
  {
    id: "nasser_qatami",
    name: "ناصر القطامي",
    englishName: "Nasser Al-Qatami",
    style: "مرتل",
    description: "تلاوة مؤثرة للقلوب",
    server: "https://server6.mp3quran.net/qtm",
    everyAyahSubfolder: "Nasser_Alqatami_128kbps",
    quranUniversalSlug: 'nasser_al_qatami_mp3quran',
    isOpenLicense: true,
    moshafId: 14,
  },
  {
    id: "bandar_baleela",
    name: "بندر بليلة",
    englishName: "Bandar Baleela",
    style: "مرتل",
    description: "إمام الحرم المكي",
    server: "https://server8.mp3quran.net/balilah",
    isOpenLicense: true,
    moshafId: 15,
  },
  {
    id: "abdullah_matrood",
    name: "عبد الله المطرود",
    englishName: "Abdullah Al-Matrood",
    style: "مرتل",
    description: "تلاوة مرتلة جميلة",
    server: "https://server11.mp3quran.net/mtrod",
    everyAyahSubfolder: "Abdullah_Matroud_128kbps",
    isOpenLicense: true,
    moshafId: 16,
  },
  {
    id: "khaled_jaleel",
    name: "خالد الجليل",
    englishName: "Khaled Al-Jaleel",
    style: "مرتل",
    description: "تلاوة خاشعة مشهورة",
    server: "https://server10.mp3quran.net/jleel",
    isOpenLicense: true,
    moshafId: 17,
  },
  {
    id: "abdulbari_thubaity",
    name: "عبد الباري الثبيتي",
    englishName: "Abdul Bari Al-Thubaity",
    style: "مرتل",
    description: "إمام الحرم النبوي",
    server: "https://server6.mp3quran.net/thbtei",
    isOpenLicense: true,
    moshafId: 18,
  },
  {
    id: "ali_jaber",
    name: "علي جابر",
    englishName: "Ali Jaber",
    style: "مرتل",
    description: "تلاوة عذبة مميزة",
    server: "https://server11.mp3quran.net/a_jbr",
    everyAyahSubfolder: "Ali_Jaber_64kbps",
    isOpenLicense: true,
    moshafId: 19,
  },
  {
    id: "abdullah_awad_juhany",
    name: "عبد الله عواد الجهني",
    englishName: "Abdullah Awad Al-Juhany",
    style: "مرتل",
    description: "إمام الحرم المكي",
    server: "https://server10.mp3quran.net/jhn",
    everyAyahSubfolder: "Abdullaah_3awwaad_Al-Juhaynee_128kbps",
    isOpenLicense: true,
    moshafId: 20,
  },
  {
    id: "muhammad_luhaidan",
    name: "محمد اللحيدان",
    englishName: "Muhammad Al-Luhaidan",
    style: "مرتل",
    description: "تلاوة خاشعة مؤثرة",
    server: "https://server6.mp3quran.net/lhdan",
    isOpenLicense: true,
    moshafId: 21,
  },
  {
    id: "salah_budair",
    name: "صلاح البدير",
    englishName: "Salah Al-Budair",
    style: "مرتل",
    description: "إمام الحرم النبوي",
    server: "https://server7.mp3quran.net/s_bud",
    everyAyahSubfolder: "Salah_Al_Budair_128kbps",
    isOpenLicense: true,
    moshafId: 22,
  },
  {
    id: "idris_abkar",
    name: "إدريس أبكر",
    englishName: "Idris Abkar",
    style: "مرتل",
    description: "تلاوة خاشعة للقلوب",
    server: "https://server8.mp3quran.net/abkr",
    isOpenLicense: true,
    moshafId: 24,
  },
  {
    id: "islam_sobhi",
    name: "إسلام صبحي",
    englishName: "Islam Sobhi",
    style: "مرتل",
    description: "صوت شاب مؤثر",
    server: "https://server14.mp3quran.net/islam",
    quranUniversalSlug: 'islam_sobhi_mp3quran',
    isOpenLicense: true,
    moshafId: 25,
  },
  {
    id: "raad_kurdi",
    name: "رعد الكردي",
    englishName: "Raad Al-Kurdi",
    style: "مرتل",
    description: "تلاوة مؤثرة وجميلة",
    server: "https://server6.mp3quran.net/kurdi",
    isOpenLicense: true,
    moshafId: 26,
  },
  {
    id: "abdullah_basfar",
    name: "عبد الله بصفر",
    englishName: "Abdullah Basfar",
    style: "مرتل",
    description: "تلاوة واضحة للحفظ",
    server: "https://server10.mp3quran.net/bsfr",
    everyAyahSubfolder: "Abdullah_Basfar_192kbps",
    isOpenLicense: true,
    moshafId: 27,
  },
  {
    id: "mansour_salimi",
    name: "منصور السالمي",
    englishName: "Mansour Al-Salimi",
    style: "مرتل",
    description: "تلاوة مؤثرة جداً",
    server: "https://server10.mp3quran.net/salmi",
    isOpenLicense: true,
    moshafId: 103,
  },

  // =====================
  // مجود - Mujawwad Style
  // =====================
  {
    id: "abdul_basit_mujawwad",
    name: "عبد الباسط عبد الصمد - مجود",
    englishName: "Abdul Basit - Mujawwad",
    style: "مجود",
    description: "تلاوة مجودة كلاسيكية شهيرة",
    server: "https://server7.mp3quran.net/basit",
    quranFoundationId: 1,
    everyAyahSubfolder: "Abdul_Basit_Mujawwad_128kbps",
    quranUniversalSlug: 'abdulbasit_abdulsamad_mujawwad_tarteel',
    isOpenLicense: true,
    moshafId: 28,
  },
  {
    id: "mahmoud_husary_mujawwad",
    name: "محمود خليل الحصري - مجود",
    englishName: "Mahmoud Khalil Al-Husary - Mujawwad",
    style: "مجود",
    description: "شيخ المقرئين - تجويد كامل",
    server: "https://server13.mp3quran.net/husr",
    quranFoundationId: 6, // FIXED: was 3 (Sudais)
    everyAyahSubfolder: "Husary_128kbps_Mujawwad",
    quranUniversalSlug: 'mahmoud_khalil_al_husary_mujawwad_tarteel',
    isOpenLicense: true,
    moshafId: 29,
  },
  {
    id: "minshawi_mujawwad",
    name: "محمد صديق المنشاوي - مجود",
    englishName: "Muhammad Siddiq Al-Minshawi - Mujawwad",
    style: "مجود",
    description: "الصوت الذهبي - تجويد مميز",
    server: "https://server10.mp3quran.net/minsh",
    quranFoundationId: 8, // Added: Minshawi Mujawwad
    everyAyahSubfolder: "Minshawy_Mujawwad_192kbps",
    isOpenLicense: true,
    moshafId: 30,
  },
  {
    id: "mohammad_tablawi",
    name: "محمد الطبلاوي - مجود",
    englishName: "Mohammad Al-Tablawi - Mujawwad",
    style: "مجود",
    description: "تلاوة مجودة مميزة",
    server: "https://server12.mp3quran.net/tblawi",
    quranFoundationId: 11, // Added: Tablawi
    everyAyahSubfolder: "Mohammad_al_Tablaway_128kbps",
    isOpenLicense: true,
    moshafId: 31,
  },

  // =====================
  // ترتيل - Tarteel Style
  // =====================
  {
    id: "mahmoud_husary_tarteel",
    name: "محمود خليل الحصري - ترتيل",
    englishName: "Mahmoud Khalil Al-Husary - Tarteel",
    style: "ترتيل",
    description: "ترتيل للتعلم والحفظ",
    server: "https://server13.mp3quran.net/husr",
    quranFoundationId: 6, // FIXED: was 3 (Sudais)
    isOpenLicense: true,
    moshafId: 36,
  },
  {
    id: "muhammad_ayyub",
    name: "محمد أيوب",
    englishName: "Muhammad Ayyub",
    style: "ترتيل",
    description: "إمام الحرم النبوي - ترتيل واضح",
    server: "https://server8.mp3quran.net/ayyub",
    everyAyahSubfolder: "Muhammad_Ayyoub_128kbps",
    isOpenLicense: true,
    moshafId: 37,
  },
  {
    id: "ali_hudhaify",
    name: "علي الحذيفي",
    englishName: "Ali Al-Hudhaify",
    style: "ترتيل",
    description: "إمام الحرم النبوي",
    server: "https://server11.mp3quran.net/hthfi",
    everyAyahSubfolder: "Hudhaify_128kbps",
    isOpenLicense: true,
    moshafId: 40,
  },
  {
    id: "abdulmohsen_qasim",
    name: "عبد المحسن القاسم",
    englishName: "Abdul Mohsen Al-Qasim",
    style: "ترتيل",
    description: "إمام الحرم النبوي",
    server: "https://server6.mp3quran.net/qasm",
    everyAyahSubfolder: "Muhsin_Al_Qasim_192kbps",
    isOpenLicense: true,
    moshafId: 39,
  },

  // =====================
  // ورش - Warsh
  // =====================
  {
    id: "yassin_jazaery_warsh",
    name: "ياسين الجزائري - ورش",
    englishName: "Yassin Al-Jazaery - Warsh",
    style: "ورش",
    description: "رواية ورش عن نافع",
    server: "https://server7.mp3quran.net/jaz_warsh",
    isOpenLicense: true,
    moshafId: 43,
  },

  // =====================
  // قالون - Qaloon
  // =====================
  {
    id: "mahmoud_husary_qaloon",
    name: "محمود خليل الحصري - قالون",
    englishName: "Mahmoud Al-Husary - Qaloon",
    style: "قالون",
    description: "رواية قالون عن نافع",
    server: "https://server13.mp3quran.net/husr_qalon",
    isOpenLicense: true,
    moshafId: 46,
  },
  {
    id: "hazza_albalushi",
    name: "هزاع البلوشي",
    englishName: "Hazza Al-Balushi",
    style: "مرتل",
    description: "تلاوة هادئة وجميلة خاشعة",
    server: "https://server11.mp3quran.net/balushi",
    everyAyahSubfolder: "Hazza_Al-Balushi_128kbps",
    isOpenLicense: true,
    moshafId: 1,
  },
  {
    id: "mahmoud_ali_albanna",
    name: "محمود علي البنا",
    englishName: "Mahmoud Ali Al-Banna",
    style: "مرتل",
    description: "من أعلام دولة التلاوة المصرية الخالدة",
    server: "https://server8.mp3quran.net/bna",
    everyAyahSubfolder: "Mahmoud_Ali_Al-Banna_32kbps",
    quranUniversalSlug: 'mahmoud_ali_al_banna_qdc',
    isOpenLicense: true,
    moshafId: 1,
  },
  {
    id: "mahmoud_ali_albanna_mujawwad",
    name: "محمود علي البنا - مجود",
    englishName: "Mahmoud Ali Al-Banna - Mujawwad",
    style: "مجود",
    description: "تلاوة مجودة تاريخية نادرة",
    server: "https://server8.mp3quran.net/bna",
    everyAyahSubfolder: "Mahmod_Ali_Albanna_128kbps",
    isOpenLicense: true,
    moshafId: 1,
  },
  {
    id: "muhammad_rifat",
    name: "محمد رفعت",
    englishName: "Muhammad Rifat",
    style: "مجود",
    description: "قيثارة السماء والصوت الملائكي الخالد",
    server: "https://server14.mp3quran.net/refat",
    isOpenLicense: true,
    moshafId: 1,
  },
  {
    id: "mustafa_ismail",
    name: "مصطفى إسماعيل - مجود",
    englishName: "Mustafa Ismail - Mujawwad",
    style: "مجود",
    description: "أمير المقرئين ورائد المقامات القرآنية",
    server: "https://server8.mp3quran.net/mustafa",
    everyAyahSubfolder: "Mustafa_Ismail_128kbps",
    quranUniversalSlug: 'mustafa_ismail_mp3quran',
    isOpenLicense: true,
    moshafId: 1,
  },
  {
    id: "husary_muallim",
    name: "محمود خليل الحصري - المعلم",
    englishName: "Mahmoud Khalil Al-Husary - Muallim",
    style: "ترتيل",
    description: "المصحف المعلم بالوقف والابتداء الدقيق",
    server: "https://server13.mp3quran.net/husr",
    quranFoundationId: 12,
    everyAyahSubfolder: "Husary_Muallim_128kbps",
    isOpenLicense: true,
    moshafId: 2,
  },
  {
    id: "khalifa_tunaiji",
    name: "خليفة الطنيجي",
    englishName: "Khalifa Al-Tunaiji",
    style: "مرتل",
    description: "تلاوة عذبة ومتقنة برواية حفص",
    server: "https://server12.mp3quran.net/tnjy",
    everyAyahSubfolder: "khalefa_al_tunaiji_64kbps",
    quranUniversalSlug: 'khalifa_al_tunaiji_tarteel',
    isOpenLicense: true,
    moshafId: 1,
  },
  {
    id: "wadih_yamani",
    name: "وديع اليمني",
    englishName: "Wadih Al-Yamani",
    style: "مرتل",
    description: "تلاوة خاشعة شجية محبوبة جداً في الريلز",
    server: "https://server6.mp3quran.net/wdee",
    isOpenLicense: true,
    moshafId: 1,
  },

  // =====================================================================
  // QUA v2.2.0 catalogue reciters (word + letter timing available)
  // =====================================================================
  {
    id: 'abdullah_al_qarafi', name: 'عبد الله القرافي', englishName: 'Abdullah Al-Qarafi', style: 'مرتل',
    description: 'تلاوة مرتلة موثقة مع توقيت الكلمات والحروف',
    server: 'https://server16.mp3quran.net/a_alqrafi/Rewayat-Hafs-A-n-Assem', quranUniversalSlug: 'abdullah_al_qarafi_mp3quran', isOpenLicense: true,
  },
  {
    id: 'abdulwadood_haneef', name: 'عبد الودود حنيف', englishName: 'Abdulwadood Haneef', style: 'مرتل',
    description: 'تلاوة مرتلة موثقة مع توقيت الكلمات والحروف',
    server: 'https://server8.mp3quran.net/wdod', quranUniversalSlug: 'abdulwadood_haneef_mp3quran', isOpenLicense: true,
  },
  {
    id: 'abdur_rashid_sufi', name: 'عبد الرشيد صوفي', englishName: 'Abdur-Rashid Sufi', style: 'مرتل',
    description: 'تلاوة مرتلة موثقة مع توقيت الكلمات والحروف',
    server: 'https://download.quranicaudio.com/quran/abdurrashid_sufi', quranUniversalSlug: 'abdur_rashid_sufi_qdc', isOpenLicense: true,
  },
  {
    id: 'ahmed_amer', name: 'أحمد عامر', englishName: 'Ahmed Amer', style: 'مرتل',
    description: 'تلاوة مرتلة موثقة مع توقيت الكلمات والحروف',
    server: 'https://download.tvquran.com/download/recitations/197/143', quranUniversalSlug: 'ahmed_amer_tvquran', isOpenLicense: true,
  },
  {
    id: 'ahmed_issa_al_maasaraawi', name: 'أحمد عيسى المعصراوي', englishName: 'Ahmed Issa Al-Maasaraawi', style: 'مرتل',
    description: 'تلاوة مرتلة موثقة مع توقيت الكلمات والحروف',
    server: 'https://server16.mp3quran.net/a_maasaraawi/Rewayat-Hafs-A-n-Assem', quranUniversalSlug: 'ahmed_issa_al_maasaraawi_mp3quran', isOpenLicense: true,
  },
  {
    id: 'ahmed_shaheen', name: 'أحمد خليل شاهين', englishName: 'Ahmed Khalil Shaheen', style: 'مرتل',
    description: 'تلاوة مرتلة موثقة مع توقيت الكلمات والحروف',
    server: 'https://server16.mp3quran.net/shaheen/Rewayat-Hafs-A-n-Assem', quranUniversalSlug: 'ahmed_shaheen_mp3quran', isOpenLicense: true,
  },
  {
    id: 'ali_al_huthaifi', name: 'علي بن عبد الرحمن الحذيفي', englishName: 'Ali Al-Huthaifi', style: 'مرتل',
    description: 'تلاوة مرتلة موثقة مع توقيت الكلمات والحروف',
    server: 'https://server9.mp3quran.net/hthfi', quranUniversalSlug: 'ali_al_huthaifi_mp3quran', isOpenLicense: true,
  },
  {
    id: 'ayman_swed', name: 'أيمن سويد', englishName: 'Ayman Suwayd', style: 'ترتيل',
    description: 'المصحف المعلم مع توقيت الكلمات والحروف',
    server: 'https://download.tvquran.com/download/recitations/346/270', quranUniversalSlug: 'ayman_swed_muallim_tvquran', isOpenLicense: true,
  },
  {
    id: 'mahmoud_abdul_hakam', name: 'محمود عبدالحكم', englishName: 'Mahmoud Abdul Hakam', style: 'مرتل',
    description: 'تلاوة مرتلة موثقة مع توقيت الكلمات والحروف',
    server: 'https://server16.mp3quran.net/m_abdelhakam/Rewayat-Hafs-A-n-Assem', quranUniversalSlug: 'mahmoud_abdul_hakam_mp3quran', isOpenLicense: true,
  },
  {
    id: 'mohammed_alghazali', name: 'محمد الغزالي', englishName: 'Mohammed Al-Ghazali', style: 'مرتل',
    description: 'تلاوة مرتلة موثقة مع توقيت الكلمات والحروف',
    server: 'https://ia601406.us.archive.org/16/items/Mohammed-Al-Ghazali', quranUniversalSlug: 'mohammed_alghazali_archive', isOpenLicense: true,
  },
  {
    id: 'mustafa_ismail_murattal', name: 'مصطفى إسماعيل', englishName: 'Mustafa Ismail', style: 'مرتل',
    description: 'تلاوة مرتلة موثقة مع توقيت الكلمات والحروف',
    server: 'https://server8.mp3quran.net/mustafa', quranUniversalSlug: 'mustafa_ismail_mp3quran', isOpenLicense: true,
  },
];

export function getAudioUrl(reciter: Reciter, surahNumber: number): string {
  const paddedNumber = surahNumber.toString().padStart(3, '0');
  return `${reciter.server}/${paddedNumber}.mp3`;
}

export function getReciterById(id: string): Reciter | undefined {
  return reciters.find(r => r.id === id);
}

export function getRecitersByStyle(style: Reciter['style']): Reciter[] {
  return reciters.filter(r => r.style === style);
}

export function getOpenLicenseReciters(): Reciter[] {
  return reciters.filter(r => r.isOpenLicense);
}

export function getAvailableStyles(): Reciter['style'][] {
  const styles = new Set(reciters.map(r => r.style));
  return Array.from(styles);
}

// Get preview audio URL for a reciter (Al-Fatiha by default)
export function getPreviewAudioUrl(reciter: Reciter): string {
  const surah = reciter.previewSurah || 1;
  return getAudioUrl(reciter, surah);
}

export function getEveryAyahUrl(reciter: Reciter, surahNumber: number, ayahNumber: number): string {
  if (!reciter.everyAyahSubfolder) {
    return getAudioUrl(reciter, surahNumber);
  }
  const paddedSurah = surahNumber.toString().padStart(3, '0');
  const paddedAyah = ayahNumber.toString().padStart(3, '0');
  return `https://everyayah.com/data/${reciter.everyAyahSubfolder}/${paddedSurah}${paddedAyah}.mp3`;
}
