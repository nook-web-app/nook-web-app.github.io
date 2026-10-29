package io.github.nookwebapp.native_ui

// The home feed order (rankFeed in app.js). Everything is worked out on this phone from things the person did on
// purpose (who they follow, what they liked, saved or replied to, "less like this", the languages they read) and never
// from time spent or scrolling.

private val WORDS = mapOf(
    "english" to "the and is are of to in that it for you with this on was have not but they your we be at or by from my so his her its our what when will can all just there their about would",
    "spanish" to "el la los las de que en un una es por con para no se su al lo como más pero sus le ya este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos",
    "french" to "le la les des est et en un une du de que qui dans pour pas sur au avec ce il elle je nous vous ils sont mais ou où plus par se ne comme tout cette très être",
    "german" to "der die das und ist nicht ein eine zu den dem des mit auf für von ich du er sie es wir ihr aber auch wie bei nach aus noch nur oder wenn dass sehr",
    "portuguese" to "os as do da em um uma para com não por mais na no dos das como mas foi ao ele ela seu sua ser quando muito já também só pelo você são",
    "italian" to "il lo gli di che un una per con non è sono ma come più anche se da del della dei delle nel nella al alla questo quello ho hai molto",
    "dutch" to "de het een en van ik te dat die niet op aan met voor zijn er maar om ook als dan nog wel naar bij uit heel",
    "turkish" to "ve bir bu da de için ile ben sen çok daha gibi ama ne mi mı var yok değil ki ya kadar",
    "indonesian" to "yang dan di ke dari ini itu dengan untuk tidak adalah saya kamu akan pada juga atau ada sudah bisa",
    "polish" to "nie na się że to jest do jak ale po co tak za od czy dla już tylko",
).mapValues { it.value.split(" ").toSet() }
private val MARKS = mapOf("spanish" to Regex("[ñ¿¡]"), "german" to Regex("[ßäöü]"), "portuguese" to Regex("[ãõ]"), "turkish" to Regex("[şğı]"), "polish" to Regex("[łąęśźż]"), "french" to Regex("[œêèùûîôâ]"))
private val PHONE_LANG = mapOf("ar" to "arabic", "zh" to "chinese", "nl" to "dutch", "en" to "english", "fr" to "french", "de" to "german", "el" to "greek", "he" to "hebrew", "iw" to "hebrew", "hi" to "hindi", "id" to "indonesian", "in" to "indonesian", "it" to "italian", "ja" to "japanese", "ko" to "korean", "fa" to "persian", "pl" to "polish", "pt" to "portuguese", "ru" to "russian", "es" to "spanish", "th" to "thai", "tr" to "turkish", "uk" to "ukrainian", "ur" to "urdu")

private val langMemo = HashMap<String, String?>()
// langOf(): which language a text is in; null when there is too little to tell (a photo with a short caption is for everybody)
fun langOf(text: String): String? {
    if (text.length < 3) return null
    langMemo[text]?.let { return it }
    if (langMemo.containsKey(text)) return null
    val r = langOfRaw(text)
    if (langMemo.size > 2000) langMemo.clear()
    langMemo[text] = r
    return r
}
// each pattern is compiled once
private val cntRe = HashMap<String, Regex>()
private val WORD_RE = Regex("\\p{L}+")
private fun cnt(t: String, re: String) = cntRe.getOrPut(re) { Regex(re) }.findAll(t).count()
private fun langOfRaw(text: String): String? {
    val kana = cnt(text, "[\\u3040-\\u30FF]"); val han = cnt(text, "[\\u3400-\\u4DBF\\u4E00-\\u9FFF]"); val hangul = cnt(text, "[\\uAC00-\\uD7AF\\u1100-\\u11FF]")
    val arab = cnt(text, "[\\u0600-\\u06FF\\u0750-\\u077F]"); val cyr = cnt(text, "[\\u0400-\\u04FF]"); val deva = cnt(text, "[\\u0900-\\u097F]")
    val thai = cnt(text, "[\\u0E00-\\u0E7F]"); val heb = cnt(text, "[\\u0590-\\u05FF]"); val greek = cnt(text, "[\\u0370-\\u03FF]")
    val lat = cnt(text, "[A-Za-z\\u00C0-\\u024F]")
    val top = maxOf(kana + han, hangul, arab, cyr, deva, thai, heb, greek, lat)
    if (top < 3) return null
    if (kana + han == top) return if (kana > 0) "japanese" else "chinese"
    if (hangul == top) return "korean"
    if (arab == top) return if (cnt(text, "[ٹڈڑںے]") > 0) "urdu" else if (cnt(text, "[پچژگ]") > 0) "persian" else "arabic"
    if (cyr == top) return if (cnt(text, "[їєґ]") > 0) "ukrainian" else "russian"
    if (deva == top) return "hindi"
    if (thai == top) return "thai"
    if (heb == top) return "hebrew"
    if (greek == top) return "greek"
    val low = text.lowercase()
    val words = WORD_RE.findAll(low).map { it.value }.toList()
    var best: String? = null; var hi = 0; var second = 0
    for ((k, set) in WORDS) {
        var sc = words.count { it in set }
        MARKS[k]?.let { sc += 2 * it.findAll(low).count() }
        if (sc > hi) { second = hi; hi = sc; best = k } else if (sc > second) second = sc
    }
    return if (hi >= 2 && hi > second) best else null
}

fun myLangs(s: Store): Set<String> {
    val ids = LANGS.map { it.first }.toSet()
    s.langs?.filter { it in ids }?.takeIf { it.isNotEmpty() }?.let { return it.toSet() }
    val set = HashSet<String>()
    java.util.Locale.getDefault().language.take(2).lowercase().let { PHONE_LANG[it]?.let { k -> set.add(k) } }
    s.posts.filter { it.mine }.take(30).forEach { p -> langOf(p.text)?.let { set.add(it) } }
    if (set.isEmpty()) set.add("english")
    return set
}

// a post that somebody you follow reposted counts from the time of the repost
fun ft(p: LPost) = p.rpBy?.let { maxOf(p.t, it.t) } ?: p.t
fun whoOf(p: LPost) = p.ra?.id ?: if (p.ai) "zenith" else "me"

private val rankCache = HashMap<String, Pair<String, List<String>>>()
fun rankFeed(s: Store, follows: Set<String>, arr: List<LPost>, tab: String): List<LPost> {
    val hidden = s.hidden.toSet()
    val langs = myLangs(s)
    val maxT = arr.maxOfOrNull { ft(it) } ?: 0
    val key = listOf(tab, arr.size, maxT, hidden.size, "${s.lessA.size}:${s.lessWords.size}", langs.sorted().joinToString(), follows.size).joinToString("|")
    // the order stays the same while the posts, the follows and the choices stay the same, so likes do not shuffle the page
    rankCache[tab]?.let { (k, ids) -> if (k == key) { val by = arr.associateBy { it.id }; return ids.mapNotNull { by[it] }.filter { it.id !in hidden } } }
    val aff = HashMap<String, Double>()
    fun add(id: String, v: Double) { aff[id] = (aff[id] ?: 0.0) + v }
    val byId = s.posts.associateBy { it.id }
    s.posts.forEach { p ->
        if (p.ra != null || p.ai) { val w = whoOf(p); if (p.liked) add(w, .25); if (p.saved) add(w, .4); if (p.reposted) add(w, .3) }
        else if (p.parent != null) { val par = byId[p.parent]; if (par != null && (par.ra != null || par.ai)) add(whoOf(par), .3) }
    }
    val now = Clock.now()
    class Sc(val p: LPost, val s: Double, val who: String)
    val scored = arr.filter { it.id !in hidden }.map { p ->
        val who = whoOf(p)
        val rec = Math.pow(.5, maxOf(0L, now - ft(p)) / 36e5 / 10)
        val a = minOf(1.5, aff[who] ?: 0.0)
        val fol = if (who in follows) 1.0 else 0.0
        var sc = if (who == "me") rec * 1.4 else rec * (1 + 2 * a + fol) + (if (fol == 0.0 && a == 0.0) .12 * rec else 0.0)
        langOf(p.text)?.let { if (it !in langs) sc *= .12 }
        s.lessA[who]?.let { sc *= Math.pow(.1, minOf(2, it).toDouble()) }
        val hitN = wordsOf(p.text).count { (s.lessWords[it] ?: 0) > 0 }
        if (hitN > 0) sc *= maxOf(.3, 1 - .25 * hitN)
        Sc(p, sc, who)
    }.sortedByDescending { it.s }
    // nobody gets three posts in a row
    val out = ArrayList<Sc>(); val rest = scored.toMutableList()
    while (rest.isNotEmpty()) {
        var i = 0
        val n = out.size
        if (n >= 2 && out[n - 1].who == out[n - 2].who) { i = rest.indexOfFirst { it.who != out[n - 1].who }; if (i < 0) i = 0 }
        out.add(rest.removeAt(i))
    }
    rankCache[tab] = key to out.map { it.p.id }
    return out.map { it.p }
}
fun clearRank() = rankCache.clear()
