export type RecitationStyle = 'مرتل' | 'مجود' | 'ترتيل' | 'معلم' | 'حفص' | 'ورش' | 'قالون';

export type Riwayah =
  | 'حفص عن عاصم'
  | 'ورش عن نافع'
  | 'قالون عن نافع'
  | 'الدوري عن أبي عمرو'
  | 'السوسي عن أبي عمرو'
  | 'شعبة عن عاصم'
  | 'خلف عن حمزة'
  | string;

export interface ReciterStyle {
  id: string;
  name: string;
  arabicName: string;
}

export interface Reciter {
  id: string;
  name: string;
  englishName: string;
  style: RecitationStyle;
  riwayah?: Riwayah;
  description?: string;
  server: string;
  subfolder?: string;
  /** @deprecated legacy source metadata; not used for alignment or rendering. */
  quranFoundationId?: number;
  everyAyahSubfolder?: string;
  /** QUA v3.2.0 word-tier package slug; the resolver supplies its paired audio URL. */
  quranUniversalSlug?: string;
  isOpenLicense?: boolean;
  moshafId?: number;
  previewSurah?: number;
}

export const recitationStyles: ReciterStyle[] = [
  { id: 'murattal', name: 'Murattal', arabicName: 'مرتل' },
  { id: 'mujawwad', name: 'Mujawwad', arabicName: 'مجود' },
  { id: 'tarteel', name: 'Tarteel', arabicName: 'ترتيل' },
  { id: 'muallim', name: 'Muallim', arabicName: 'معلم' },
  { id: 'hafs', name: 'Hafs', arabicName: 'حفص' },
  { id: 'warsh', name: 'Warsh', arabicName: 'ورش' },
  { id: 'qaloon', name: 'Qaloon', arabicName: 'قالون' },
];

export const reciters: Reciter[] = [
  // =====================
  // مرتل - Murattal Style (حفص عن عاصم)
  // =====================
  {
    id: "mishary_alafasy",
    name: "مشاري راشد العفاسي",
    englishName: "Mishary Rashid Alafasy",
    style: "مرتل",
    riwayah: "حفص عن عاصم",
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
    riwayah: "حفص عن عاصم",
    description: "تلاوة مرتلة كلاسيكية متقنة",
    server: "https://server8.mp3quran.net/basit",
    quranFoundationId: 2,
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
    riwayah: "حفص عن عاصم",
    description: "شيخ عموم المقارئ المصرية - تلاوة مرتلة متقنة",
    server: "https://server13.mp3quran.net/husr",
    quranFoundationId: 6,
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
    riwayah: "حفص عن عاصم",
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
    riwayah: "حفص عن عاصم",
    description: "إمام الحرم المكي الشريف",
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
    riwayah: "حفص عن عاصم",
    description: "إمام الحرم المكي السابق",
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
    riwayah: "حفص عن عاصم",
    description: "إمام الحرم المكي ورئيس الشؤون الدينية",
    server: "https://server11.mp3quran.net/sds",
    quranFoundationId: 3,
    everyAyahSubfolder: "Abdurrahmaan_As-Sudais_192kbps",
    isOpenLicense: true,
    moshafId: 8,
  },
  {
    id: "abu_bakr_shatri",
    name: "أبو بكر الشاطري",
    englishName: "Abu Bakr Al-Shatri",
    style: "مرتل",
    riwayah: "حفص عن عاصم",
    description: "تلاوة خاشعة ناعمة ومحبوبة",
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
    riwayah: "حفص عن عاصم",
    description: "تلاوة هادئة رخيمة ومميزة",
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
    riwayah: "حفص عن عاصم",
    description: "تلاوة حماسية خاشعة ومؤثرة",
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
    riwayah: "حفص عن عاصم",
    description: "تلاوة مؤثرة بكائية للقلوب",
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
    riwayah: "حفص عن عاصم",
    description: "صوت شجي هادئ ومؤثر",
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
    riwayah: "حفص عن عاصم",
    description: "إمام الحرم المكي الشريف - صوت آسر",
    server: "https://server11.mp3quran.net/yasser",
    quranFoundationId: 97,
    everyAyahSubfolder: "Yasser_Ad-Dussary_128kbps",
    isOpenLicense: true,
    moshafId: 13,
  },
  {
    id: "nasser_qatami",
    name: "ناصر القطامي",
    englishName: "Nasser Al-Qatami",
    style: "مرتل",
    riwayah: "حفص عن عاصم",
    description: "تلاوة ندية مؤثرة للقلوب",
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
    riwayah: "حفص عن عاصم",
    description: "إمام الحرم المكي الشريف",
    server: "https://server8.mp3quran.net/balilah",
    isOpenLicense: true,
    moshafId: 15,
  },
  {
    id: "abdullah_matrood",
    name: "عبد الله المطرود",
    englishName: "Abdullah Al-Matrood",
    style: "مرتل",
    riwayah: "حفص عن عاصم",
    description: "تلاوة مرتلة وقورة وجميلة",
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
    riwayah: "حفص عن عاصم",
    description: "تلاوة خاشعة مشهورة ومؤثرة",
    server: "https://server10.mp3quran.net/jleel",
    isOpenLicense: true,
    moshafId: 17,
  },
  {
    id: "abdulbari_thubaity",
    name: "عبد الباري الثبيتي",
    englishName: "Abdul Bari Al-Thubaity",
    style: "مرتل",
    riwayah: "حفص عن عاصم",
    description: "إمام الحرم النبوي الشريف",
    server: "https://server6.mp3quran.net/thbtei",
    isOpenLicense: true,
    moshafId: 18,
  },
  {
    id: "ali_jaber",
    name: "علي جابر",
    englishName: "Ali Jaber",
    style: "مرتل",
    riwayah: "حفص عن عاصم",
    description: "تلاوة الحرم المكي العذبة الخالدة",
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
    riwayah: "حفص عن عاصم",
    description: "إمام الحرم المكي الشريف",
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
    riwayah: "حفص عن عاصم",
    description: "تلاوة نجدية خاشعة ومؤثرة",
    server: "https://server6.mp3quran.net/lhdan",
    isOpenLicense: true,
    moshafId: 21,
  },
  {
    id: "salah_budair",
    name: "صلاح البدير",
    englishName: "Salah Al-Budair",
    style: "مرتل",
    riwayah: "حفص عن عاصم",
    description: "إمام وخطيب الحرم النبوي الشريف",
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
    riwayah: "حفص عن عاصم",
    description: "تلاوة عذبة وخاشعة ترق لها القلوب",
    server: "https://server8.mp3quran.net/abkr",
    isOpenLicense: true,
    moshafId: 24,
  },
  {
    id: "islam_sobhi",
    name: "إسلام صبحي",
    englishName: "Islam Sobhi",
    style: "مرتل",
    riwayah: "حفص عن عاصم",
    description: "صوت شاب شجي ذائع الصيت",
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
    riwayah: "حفص عن عاصم",
    description: "تلاوة هادئة وجميلة مميزة",
    server: "https://server6.mp3quran.net/kurdi",
    isOpenLicense: true,
    moshafId: 26,
  },
  {
    id: "abdullah_basfar",
    name: "عبد الله بصفر",
    englishName: "Abdullah Basfar",
    style: "مرتل",
    riwayah: "حفص عن عاصم",
    description: "تلاوة هادئة واضحة للحفظ والمدارسة",
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
    riwayah: "حفص عن عاصم",
    description: "تلاوة خاشعة ومؤثرة جداً",
    server: "https://server10.mp3quran.net/salmi",
    isOpenLicense: true,
    moshafId: 103,
  },
  {
    id: "hazza_albalushi",
    name: "هزاع البلوشي",
    englishName: "Hazza Al-Balushi",
    style: "مرتل",
    riwayah: "حفص عن عاصم",
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
    riwayah: "حفص عن عاصم",
    description: "من أعلام دولة التلاوة المصرية الخالدة",
    server: "https://server8.mp3quran.net/bna",
    everyAyahSubfolder: "mahmoud_ali_al_banna_32kbps",
    quranUniversalSlug: 'mahmoud_ali_al_banna_qdc',
    isOpenLicense: true,
    moshafId: 1,
  },
  {
    id: "khalifa_tunaiji",
    name: "خليفة الطنيجي",
    englishName: "Khalifa Al-Tunaiji",
    style: "مرتل",
    riwayah: "حفص عن عاصم",
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
    riwayah: "حفص عن عاصم",
    description: "تلاوة خاشعة شجية محبوبة جداً في الريلز",
    server: "https://server6.mp3quran.net/wdee",
    isOpenLicense: true,
    moshafId: 1,
  },
  {
    id: 'abdullah_al_qarafi',
    name: 'عبد الله القرافي',
    englishName: 'Abdullah Al-Qarafi',
    style: 'مرتل',
    riwayah: 'حفص عن عاصم',
    description: 'تلاوة مرتلة مع توقيت الكلمات بحسب بيانات المحاذاة المثبتة',
    server: 'https://server16.mp3quran.net/a_alqrafi/Rewayat-Hafs-A-n-Assem',
    quranUniversalSlug: 'abdullah_al_qarafi_mp3quran',
    isOpenLicense: true,
  },
  {
    id: 'abdulwadood_haneef',
    name: 'عبد الودود حنيف',
    englishName: 'Abdulwadood Haneef',
    style: 'مرتل',
    riwayah: 'حفص عن عاصم',
    description: 'تلاوة مرتلة مع توقيت الكلمات بحسب بيانات المحاذاة المثبتة',
    server: 'https://server8.mp3quran.net/wdod',
    quranUniversalSlug: 'abdulwadood_haneef_mp3quran',
    isOpenLicense: true,
  },
  {
    id: 'abdur_rashid_sufi',
    name: 'عبد الرشيد صوفي',
    englishName: 'Abdur-Rashid Sufi',
    style: 'مرتل',
    riwayah: 'حفص عن عاصم',
    description: 'تلاوة مرتلة مع توقيت الكلمات بحسب بيانات المحاذاة المثبتة',
    server: 'https://download.quranicaudio.com/quran/abdurrashid_sufi',
    quranUniversalSlug: 'abdur_rashid_sufi_qdc',
    isOpenLicense: true,
  },
  {
    id: 'ahmed_amer',
    name: 'أحمد عامر',
    englishName: 'Ahmed Amer',
    style: 'مرتل',
    riwayah: 'حفص عن عاصم',
    description: 'تلاوة مرتلة مع توقيت الكلمات بحسب بيانات المحاذاة المثبتة',
    server: 'https://download.tvquran.com/download/recitations/197/143',
    quranUniversalSlug: 'ahmed_amer_tvquran',
    isOpenLicense: true,
  },
  {
    id: 'ahmed_issa_al_maasaraawi',
    name: 'أحمد عيسى المعصراوي',
    englishName: 'Ahmed Issa Al-Maasaraawi',
    style: 'مرتل',
    riwayah: 'حفص عن عاصم',
    description: 'تلاوة مرتلة مع توقيت الكلمات بحسب بيانات المحاذاة المثبتة',
    server: 'https://server16.mp3quran.net/a_maasaraawi/Rewayat-Hafs-A-n-Assem',
    quranUniversalSlug: 'ahmed_issa_al_maasaraawi_mp3quran',
    isOpenLicense: true,
  },
  {
    id: 'ahmed_shaheen',
    name: 'أحمد خليل شاهين',
    englishName: 'Ahmed Khalil Shaheen',
    style: 'مرتل',
    riwayah: 'حفص عن عاصم',
    description: 'تلاوة مرتلة مع توقيت الكلمات بحسب بيانات المحاذاة المثبتة',
    server: 'https://server16.mp3quran.net/shaheen/Rewayat-Hafs-A-n-Assem',
    quranUniversalSlug: 'ahmed_shaheen_mp3quran',
    isOpenLicense: true,
  },
  {
    id: 'ali_al_huthaifi',
    name: 'علي بن عبد الرحمن الحذيفي',
    englishName: 'Ali Al-Huthaifi',
    style: 'مرتل',
    riwayah: 'حفص عن عاصم',
    description: 'تلاوة مرتلة مع توقيت الكلمات بحسب بيانات المحاذاة المثبتة',
    server: 'https://server9.mp3quran.net/hthfi',
    quranUniversalSlug: 'ali_al_huthaifi_mp3quran',
    isOpenLicense: true,
  },
  {
    id: 'mahmoud_abdul_hakam',
    name: 'محمود عبدالحكم',
    englishName: 'Mahmoud Abdul Hakam',
    style: 'مرتل',
    riwayah: 'حفص عن عاصم',
    description: 'تلاوة مرتلة مع توقيت الكلمات بحسب بيانات المحاذاة المثبتة',
    server: 'https://server16.mp3quran.net/m_abdelhakam/Rewayat-Hafs-A-n-Assem',
    quranUniversalSlug: 'mahmoud_abdul_hakam_mp3quran',
    isOpenLicense: true,
  },
  {
    id: 'mohammed_alghazali',
    name: 'محمد الغزالي',
    englishName: 'Mohammed Al-Ghazali',
    style: 'مرتل',
    riwayah: 'حفص عن عاصم',
    description: 'تلاوة مرتلة مع توقيت الكلمات بحسب بيانات المحاذاة المثبتة',
    server: 'https://ia601406.us.archive.org/16/items/Mohammed-Al-Ghazali',
    quranUniversalSlug: 'mohammed_alghazali_archive',
    isOpenLicense: true,
  },
  {
    id: 'mustafa_ismail_murattal',
    name: 'مصطفى إسماعيل',
    englishName: 'Mustafa Ismail',
    style: 'مرتل',
    riwayah: 'حفص عن عاصم',
    description: 'تلاوة مرتلة مع توقيت الكلمات بحسب بيانات المحاذاة المثبتة',
    server: 'https://server8.mp3quran.net/mustafa',
    quranUniversalSlug: 'mustafa_ismail_mp3quran',
    isOpenLicense: true,
  },

  // =====================
  // مجود - Mujawwad Style
  // =====================
  {
    id: "abdul_basit_mujawwad",
    name: "عبد الباسط عبد الصمد - مجود",
    englishName: "Abdul Basit - Mujawwad",
    style: "مجود",
    riwayah: "حفص عن عاصم",
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
    riwayah: "حفص عن عاصم",
    description: "شيخ المقرئين - تجويد كامل متقن",
    server: "https://server13.mp3quran.net/husr",
    quranFoundationId: 6,
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
    riwayah: "حفص عن عاصم",
    description: "الصوت الذهبي الخالد - تجويد لا مثيل له",
    server: "https://server10.mp3quran.net/minsh",
    quranFoundationId: 8,
    everyAyahSubfolder: "Minshawy_Mujawwad_192kbps",
    isOpenLicense: true,
    moshafId: 30,
  },
  {
    id: "mohammad_tablawi",
    name: "محمد الطبلاوي - مجود",
    englishName: "Mohammad Al-Tablawi - Mujawwad",
    style: "مجود",
    riwayah: "حفص عن عاصم",
    description: "تلاوة مجودة متميزة بأداء مصري أصيل",
    server: "https://server12.mp3quran.net/tblawi",
    quranFoundationId: 11,
    everyAyahSubfolder: "Mohammad_al_Tablaway_128kbps",
    isOpenLicense: true,
    moshafId: 31,
  },
  {
    id: "mahmoud_ali_albanna_mujawwad",
    name: "محمود علي البنا - مجود",
    englishName: "Mahmoud Ali Al-Banna - Mujawwad",
    style: "مجود",
    riwayah: "حفص عن عاصم",
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
    riwayah: "حفص عن عاصم",
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
    riwayah: "حفص عن عاصم",
    description: "أمير المقرئين ورائد المقامات القرآنية",
    server: "https://server8.mp3quran.net/mustafa",
    everyAyahSubfolder: "Mustafa_Ismail_48kbps",
    quranUniversalSlug: 'mustafa_ismail_mp3quran',
    isOpenLicense: true,
    moshafId: 1,
  },

  // =====================
  // ترتيل - Tarteel Style
  // =====================
  {
    id: "mahmoud_husary_tarteel",
    name: "محمود خليل الحصري - ترتيل",
    englishName: "Mahmoud Khalil Al-Husary - Tarteel",
    style: "ترتيل",
    riwayah: "حفص عن عاصم",
    description: "ترتيل هادئ متقن للتعلم والحفظ",
    server: "https://server13.mp3quran.net/husr",
    quranFoundationId: 6,
    isOpenLicense: true,
    moshafId: 36,
  },
  {
    id: "muhammad_ayyub",
    name: "محمد أيوب",
    englishName: "Muhammad Ayyub",
    style: "ترتيل",
    riwayah: "حفص عن عاصم",
    description: "إمام الحرم النبوي - ترتيل حجازي رخيم",
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
    riwayah: "حفص عن عاصم",
    description: "إمام الحرم النبوي الشريف - ترتيل متقن",
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
    riwayah: "حفص عن عاصم",
    description: "إمام الحرم النبوي الشريف",
    server: "https://server6.mp3quran.net/qasm",
    everyAyahSubfolder: "Muhsin_Al_Qasim_192kbps",
    isOpenLicense: true,
    moshafId: 39,
  },

  // =====================
  // المصحف المعلم - Muallim Style
  // =====================
  {
    id: "husary_muallim",
    name: "محمود خليل الحصري - المعلم",
    englishName: "Mahmoud Khalil Al-Husary - Muallim",
    style: "معلم",
    riwayah: "حفص عن عاصم",
    description: "المصحف المعلم بالوقف والابتداء الدقيق وترديد الطلاب",
    server: "https://server13.mp3quran.net/husr",
    quranFoundationId: 12,
    everyAyahSubfolder: "Husary_Muallim_128kbps",
    isOpenLicense: true,
    moshafId: 2,
  },
  {
    id: "minshawi_muallim",
    name: "محمد صديق المنشاوي - المعلم",
    englishName: "Muhammad Siddiq Al-Minshawi - Muallim",
    style: "معلم",
    riwayah: "حفص عن عاصم",
    description: "المصحف المعلم بصوت الشيخ المنشاوي وترديد الأطفال",
    server: "https://server10.mp3quran.net/minsh/Almusshaf-Al-Mo-lim",
    everyAyahSubfolder: "Minshawy_Teacher_128kbps",
    isOpenLicense: true,
  },
  {
    id: 'ayman_swed',
    name: 'أيمن سويد',
    englishName: 'Ayman Suwayd',
    style: 'معلم',
    riwayah: 'حفص عن عاصم',
    description: 'المصحف المعلم - شرح مخارج الحروف وأحكام التجويد',
    server: 'https://download.tvquran.com/download/recitations/346/270',
    everyAyahSubfolder: 'Ayman_Sowaid_64kbps',
    isOpenLicense: true,
  },

  // =====================
  // ورش عن نافع - Warsh an Nafi
  // =====================
  {
    id: "abdul_basit_warsh",
    name: "عبد الباسط عبد الصمد - ورش",
    englishName: "Abdul Basit Abdul Samad - Warsh",
    style: "مرتل",
    riwayah: "ورش عن نافع",
    description: "تلاوة مرتلة برواية ورش عن نافع من طريق الأزرق",
    server: "https://server7.mp3quran.net/basit/Rewayat-Warsh-A-n-Nafi",
    everyAyahSubfolder: "warsh/warsh_Abdul_Basit_128kbps",
    isOpenLicense: true,
  },
  {
    id: "ibrahim_dosri_warsh",
    name: "إبراهيم الدوسري - ورش",
    englishName: "Ibrahim Al-Dosary - Warsh",
    style: "مرتل",
    riwayah: "ورش عن نافع",
    description: "تلاوة متقنة برواية ورش عن نافع",
    server: "https://server10.mp3quran.net/ibrahim_dosri/Rewayat-Warsh-A-n-Nafi",
    everyAyahSubfolder: "warsh/warsh_ibrahim_aldosary_128kbps",
    isOpenLicense: true,
  },
  {
    id: "yassin_jazaery_warsh",
    name: "ياسين الجزائري - ورش",
    englishName: "Yassin Al-Jazaery - Warsh",
    style: "مرتل",
    riwayah: "ورش عن نافع",
    description: "تلاوة خاشعة برواية ورش عن نافع",
    server: "https://server11.mp3quran.net/qari",
    everyAyahSubfolder: "warsh/warsh_yassin_al_jazaery_64kbps",
    isOpenLicense: true,
    moshafId: 43,
  },
  {
    id: "mahmoud_husary_warsh",
    name: "محمود خليل الحصري - ورش",
    englishName: "Mahmoud Khalil Al-Husary - Warsh",
    style: "مرتل",
    riwayah: "ورش عن نافع",
    description: "شيخ عموم المقارئ المصرية برواية ورش عن نافع",
    server: "https://server13.mp3quran.net/husr/Rewayat-Warsh-A-n-Nafi",
    isOpenLicense: true,
  },
  {
    id: "omar_qazabri_warsh",
    name: "عمر القزابري - ورش",
    englishName: "Omar Al-Qazabri - Warsh",
    style: "مرتل",
    riwayah: "ورش عن نافع",
    description: "إمام مسجد الحسن الثاني بالدار البيضاء - ورش عن نافع",
    server: "https://server9.mp3quran.net/omar_warsh",
    isOpenLicense: true,
  },
  {
    id: "koshi_warsh",
    name: "العيون الكوشي - ورش",
    englishName: "Al-Uyun Al-Koushi - Warsh",
    style: "مرتل",
    riwayah: "ورش عن نافع",
    description: "تلاوة مغربية عذبة برواية ورش عن نافع",
    server: "https://server11.mp3quran.net/koshi",
    isOpenLicense: true,
  },

  // =====================
  // قالون عن نافع - Qaloon an Nafi
  // =====================
  {
    id: "mahmoud_husary_qaloon",
    name: "محمود خليل الحصري - قالون",
    englishName: "Mahmoud Al-Husary - Qaloon",
    style: "مرتل",
    riwayah: "قالون عن نافع",
    description: "رواية قالون عن نافع المدني - شيخ المقارئ",
    server: "https://server13.mp3quran.net/husr/Rewayat-Qalon-A-n-Nafi",
    isOpenLicense: true,
    moshafId: 46,
  },
  {
    id: "ali_hudhaify_qaloon",
    name: "علي الحذيفي - قالون",
    englishName: "Ali Al-Hudhaify - Qaloon",
    style: "ترتيل",
    riwayah: "قالون عن نافع",
    description: "إمام الحرم النبوي برواية قالون عن نافع",
    server: "https://server9.mp3quran.net/huthifi_qalon",
    isOpenLicense: true,
  },
  {
    id: "dokali_qaloon",
    name: "الدوكالي محمد العالم - قالون",
    englishName: "Al-Dokali Muhammad Al-Alim - Qaloon",
    style: "مرتل",
    riwayah: "قالون عن نافع",
    description: "تلاوة ليبية متقنة برواية قالون عن نافع",
    server: "https://server7.mp3quran.net/dokali",
    isOpenLicense: true,
  },

  // =====================
  // الدوري عن أبي عمرو - Al-Duri an Abi Amr
  // =====================
  {
    id: "nourin_siddig_duri",
    name: "نورين محمد صديق - الدوري",
    englishName: "Nourin Mohamed Siddig - Al-Duri",
    style: "مرتل",
    riwayah: "الدوري عن أبي عمرو",
    description: "تلاوة سودانية شجية خاشعة ومؤثرة جداً",
    server: "https://server16.mp3quran.net/nourin_siddig/Rewayat-Aldori-A-n-Abi-Amr",
    isOpenLicense: true,
  },
  {
    id: "fateh_zubeir_duri",
    name: "الفاتح محمد الزبير - الدوري",
    englishName: "Al-Fateh Muhammad Al-Zubair - Al-Duri",
    style: "مرتل",
    riwayah: "الدوري عن أبي عمرو",
    description: "تلاوة سودانية أصيلة برواية الدوري عن أبي عمرو",
    server: "https://server6.mp3quran.net/fateh",
    isOpenLicense: true,
  },
  {
    id: "mahmoud_husary_duri",
    name: "محمود خليل الحصري - الدوري",
    englishName: "Mahmoud Khalil Al-Husary - Al-Duri",
    style: "مرتل",
    riwayah: "الدوري عن أبي عمرو",
    description: "المصحف المرتل برواية الدوري عن أبي عمرو",
    server: "https://server13.mp3quran.net/husr/Rewayat-Aldori-A-n-Abi-Amr",
    isOpenLicense: true,
  },

  // =====================
  // السوسي عن أبي عمرو - Al-Susi an Abi Amr
  // =====================
  {
    id: "abdur_rashid_sufi_soosi",
    name: "عبد الرشيد صوفي - السوسي",
    englishName: "Abdur-Rashid Sufi - Al-Susi",
    style: "مرتل",
    riwayah: "السوسي عن أبي عمرو",
    description: "رواية السوسي عن أبي عمرو مع الإدغام الكبير",
    server: "https://server16.mp3quran.net/soufi/Rewayat-Assosi-A-n-Abi-Amr",
    isOpenLicense: true,
  },

  // =====================
  // شعبة عن عاصم - Shu'bah an Asim
  // =====================
  {
    id: "muftah_sultany_shubah",
    name: "مفتاح السلطني - شعبة",
    englishName: "Muftah Al-Sultany - Shu'bah",
    style: "مرتل",
    riwayah: "شعبة عن عاصم",
    description: "رواية شعبة عن عاصم الكوفي بأداء متقن",
    server: "https://server14.mp3quran.net/muftah_sultany/Rewayat_Sho-bah-A-n-Asim",
    isOpenLicense: true,
  },

  // =====================
  // خلف عن حمزة - Khalaf an Hamzah
  // =====================
  {
    id: "abdur_rashid_sufi_khalaf",
    name: "عبد الرشيد صوفي - خلف عن حمزة",
    englishName: "Abdur-Rashid Sufi - Khalaf an Hamzah",
    style: "مرتل",
    riwayah: "خلف عن حمزة",
    description: "رواية خلف عن حمزة الكوفي مع السكت وترك السكت",
    server: "https://server16.mp3quran.net/soufi/Rewayat-Khalaf-A-n-Hamzah",
    isOpenLicense: true,
  },
];

export function isAccreditedReciter(reciter?: Reciter | null): boolean {
  if (!reciter) return false;
  return Boolean(reciter.quranUniversalSlug || reciter.everyAyahSubfolder);
}

export function getReciterRiwayah(reciter?: Reciter | null): string {
  if (!reciter) return 'حفص عن عاصم';
  if (reciter.riwayah) return reciter.riwayah;
  if (reciter.style === 'ورش' || reciter.id.includes('warsh') || reciter.name.includes('ورش')) return 'ورش عن نافع';
  if (reciter.style === 'قالون' || reciter.id.includes('qaloon') || reciter.id.includes('qalon') || reciter.name.includes('قالون')) return 'قالون عن نافع';
  return 'حفص عن عاصم';
}

export function getAvailableRiwayahs(): { id: string; name: string; arabicName: string }[] {
  return [
    { id: 'all', name: 'All Riwayahs', arabicName: 'جميع الروايات' },
    { id: 'hafs', name: 'Hafs an Asim', arabicName: 'حفص عن عاصم' },
    { id: 'warsh', name: 'Warsh an Nafi', arabicName: 'ورش عن نافع' },
    { id: 'qaloon', name: 'Qaloon an Nafi', arabicName: 'قالون عن نافع' },
    { id: 'duri', name: 'Al-Duri an Abi Amr', arabicName: 'الدوري عن أبي عمرو' },
    { id: 'soosi', name: 'Al-Susi an Abi Amr', arabicName: 'السوسي عن أبي عمرو' },
    { id: 'shubah', name: 'Shu\'bah an Asim', arabicName: 'شعبة عن عاصم' },
    { id: 'khalaf', name: 'Khalaf an Hamzah', arabicName: 'خلف عن حمزة' },
  ];
}

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
