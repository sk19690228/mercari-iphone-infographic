/**
 * Mercari page fetch relay for Google Apps Script.
 *
 * Script properties:
 *   APP_TOKEN required: same value as the PWA relay token
 *
 * This version does not access Gmail. It fetches the fixed Mercari search URL
 * and returns the products found on that page.
 */

var AVG_PRICES_KEY = 'AVG_PRICES_V1';
var CODE_VERSION = '40';
var USER_AGENT = 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';
var LIST_PAGE_USER_AGENTS = [
  'Googlebot/2.1 (+http://www.google.com/bot.html)',
  'facebookexternalhit/1.1',
  'Twitterbot/1.0'
];
var FIXED_SEARCH_URL = 'https://jp.mercari.com/search?keyword=iPhone%2016%20SIM%E3%83%95%E3%83%AA%E3%83%BC&exclude_keyword=%E3%82%B8%E3%83%A3%E3%83%B3%E3%82%AF%20%E7%A9%BA%E7%AE%B1%20%E7%AE%B1%E3%81%AE%E3%81%BF%20%E6%9C%AC%E4%BD%93%E3%81%AA%E3%81%97%20%E9%83%A8%E5%93%81%E5%8F%96%E3%82%8A%20%E7%94%BB%E9%9D%A2%E5%89%B2%E3%82%8C%20%E8%83%8C%E9%9D%A2%E5%89%B2%E3%82%8C%20%E9%9B%BB%E6%BA%90%E3%81%8C%E5%85%A5%E3%82%89%E3%81%AA%E3%81%84%20%E5%8B%95%E4%BD%9C%E6%9C%AA%E7%A2%BA%E8%AA%8D%20%E8%B5%A4%E3%83%AD%E3%83%A0%20%E5%88%A9%E7%94%A8%E5%88%B6%E9%99%90%20%E5%B0%82%E7%94%A8%20%E3%81%BE%E3%81%A8%E3%82%81%E5%A3%B2%E3%82%8A%20%E3%82%AA%E3%83%BC%E3%82%AF%E3%82%B7%E3%83%A7%E3%83%B3&category_id=859&brand_id=3272&item_condition_id=1%2C2%2C3%2C4&shipping_payer_id=2&status=on_sale&sort=created_time&order=desc&56fcd98f-fa8c-433a-9db8-08357a2a91b9=c5b8c2cd-55ad-408a-b847-fc30d34c85e7&65d9027d-6a4a-4a9c-8492-b47269daa6c4=003798d3-8d6d-4df9-9607-fc91d6e53de4&85b41c1f-b85d-5885-8712-df90e36ca756=a373dd2d-b286-5e31-98d2-93b6ba25c88f&aeefca14-9502-497e-ada3-9bb1453e8052=074973db-03b4-4679-96ee-f7a478722f12%2C3d58df82-fce6-4cdc-8257-6e156a66b832%2C3febe959-bc95-4f0d-8a8b-6020b1d638c6%2C40fce7a8-c756-4096-b826-95c9f2f707ac%2Ce4e3a8a9-1f94-4b08-87c2-5769b1dca423&cc57d8a4-d67a-43c5-956c-4f46d1c3dcb2=06cd1bea-d847-4cb6-8281-6843da0116ab%2C210e34cd-8f42-4da9-916b-fcd48a7c0c57%2C457f80de-69e6-49fe-9b4a-a0008e2a6b9a%2C45ee42e5-88c8-459f-89fe-f4ad8a805722%2C50ba3eff-b7fa-4f28-b0dd-afcb9e4c98f1&ce318123-cf86-48ed-b132-d3896ec9a23c=9b36bbee-1abd-414d-8b20-a80a2745621b&source_location=26530_mail_t';

function doGet(e) {
  var p = e && e.parameter ? e.parameter : {};
  var callback = safeCallback_(p.callback);
  try {
    verifyToken_(p.token || '');
    var action = String(p.action || 'healthManual');
    var result;
    if (action === 'healthManual') result = healthManual_();
    else if (action === 'searchFixedPage') result = searchFixedPage_(p);
    else if (action === 'searchListPage') result = searchListPage_(p);
    else if (action === 'getAppConfig') result = getAppConfig_();
    else if (action === 'saveAvgPrices') result = saveAvgPrices_(p.data);
    else if (action === 'fetchItem') result = fetchItem_(p.url);
    else throw new Error('未対応の処理です: ' + action);
    result = result || {};
    result.ok = true;
    return output_(result, callback);
  } catch (err) {
    return output_({ok:false, error:String(err && err.message ? err.message : err)}, callback);
  }
}

function healthManual_() {
  return {
    provider: 'メルカリURL取得中継 v' + CODE_VERSION,
    projectId: ScriptApp.getScriptId(),
    gmailAccess: false,
    fixedSearch: true,
    checkedAt: new Date().toISOString()
  };
}

function verifyToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('APP_TOKEN') || '';
  if (!expected) throw new Error('スクリプトプロパティにAPP_TOKENを設定してください');
  if (String(token) !== String(expected)) throw new Error('中継用トークンが一致しません');
}

function safeCallback_(value) {
  var callback = String(value || '');
  return /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback) ? callback : '';
}

function output_(data, callback) {
  var json = JSON.stringify(data).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function searchFixedPage_(p) {
  return searchListPage_({url:FIXED_SEARCH_URL, max_items:p.max_items});
}

function searchListPage_(p) {
  var started = Date.now();
  var maxItems = clamp_(p.max_items, 1, 100, 40);
  var sourceUrl = validateManualMercariUrl_(p.url);
  var directItemUrls = [];
  var warnings = [];
  var listPageFetched = false;
  var directMatch = sourceUrl.match(/^https:\/\/(?:jp\.)?mercari\.com\/(?:item|shops\/product)\/[A-Za-z0-9_-]+/i);
  if (directMatch) {
    directItemUrls.push(normalizeMercariUrl_(directMatch[0]));
  } else {
    // Mercari search pages load products with JavaScript for normal browsers.
    // The public crawler view contains the same results in the HTML, allowing
    // Apps Script to extract product links without browser automation.
    var listResult = fetchListPageLinks_(sourceUrl);
    if (!listResult.pageFetched) throw new Error('固定検索ページを取得できませんでした');
    listPageFetched = true;
    directItemUrls = listResult.links;
    if (listResult.warning) warnings.push(listResult.warning);
  }
  directItemUrls = unique_(directItemUrls);
  if (!directItemUrls.length) throw new Error('固定検索ページから商品リンクを検出できませんでした');
  var targetUrls = directItemUrls.slice(0, maxItems);
  var responses = fetchAllSafe_(targetUrls);
  var items = [];
  responses.forEach(function(entry, index) {
    var url = targetUrls[index];
    if (!entry.ok) {
      warnings.push('商品ページを取得できませんでした: ' + shortUrl_(url));
      return;
    }
    var item = parseMercariItem_(entry.text, url, null);
    if (!item || !item.url) return;
    items.push(item);
  });
  return {
    items: items,
    sourceUrl: sourceUrl,
    sourceType: directMatch ? 'item' : 'list',
    listPageFetched: listPageFetched,
    listItemsFound: directItemUrls.length,
    foundUrls: targetUrls.length,
    remainingDueToLimit: directItemUrls.length > maxItems,
    warnings: unique_(warnings).slice(0, 12),
    elapsedMs: Date.now() - started,
    checkedAt: new Date().toISOString()
  };
}

function fetchListPageLinks_(url) {
  var pageFetched = false;
  for (var i = 0; i < LIST_PAGE_USER_AGENTS.length; i++) {
    var page = fetchAllSafe_([url], LIST_PAGE_USER_AGENTS[i])[0];
    if (!page || !page.ok) continue;
    pageFetched = true;
    var links = extractMercariLinks_(page.text).items;
    if (links.length) {
      return {
        pageFetched:true,
        links:links,
        warning:i ? '商品一覧の取得方式を自動で切り替えました' : ''
      };
    }
  }
  return {pageFetched:pageFetched, links:[], warning:''};
}

function validateManualMercariUrl_(value) {
  var url = String(value || '').trim();
  if (!url || url.length > 3000) throw new Error('メルカリURLを確認してください');
  if (!/^https:\/\/(?:[A-Za-z0-9-]+\.)*mercari\.com(?:\/|$)/i.test(url)) {
    throw new Error('https://jp.mercari.com/ で始まるURLを入力してください');
  }
  return cleanUrl_(url);
}

function fetchAllSafe_(urls, userAgent) {
  if (!urls.length) return [];
  var requestUserAgent = String(userAgent || USER_AGENT);
  var requests = urls.map(function(url) {
    return {
      url: url,
      method: 'get',
      escaping: false,
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {
        'User-Agent': requestUserAgent,
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.5',
        'Accept': 'text/html,application/xhtml+xml'
      }
    };
  });
  try {
    var responses = UrlFetchApp.fetchAll(requests);
    return responses.map(function(response) {
      var code = response.getResponseCode();
      return {ok:code >= 200 && code < 400, code:code, text:response.getContentText('UTF-8')};
    });
  } catch (err) {
    return urls.map(function(url) {
      try {
        var response = UrlFetchApp.fetch(url, {
          method:'get', escaping:false, followRedirects:true, muteHttpExceptions:true,
          headers:{'User-Agent':requestUserAgent, 'Accept-Language':'ja-JP,ja;q=0.9,en;q=0.5'}
        });
        var code = response.getResponseCode();
        return {ok:code >= 200 && code < 400, code:code, text:response.getContentText('UTF-8')};
      } catch (inner) {
        return {ok:false, code:0, text:''};
      }
    });
  }
}

function extractMercariLinks_(source) {
  var text = decodeHtml_(String(source || ''));
  var candidates = [];
  var urlPattern = /https?:\/\/[^\s<>"']+/gi;
  var match;
  while ((match = urlPattern.exec(text)) !== null) candidates.push(cleanUrl_(match[0]));
  var hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;
  while ((match = hrefPattern.exec(text)) !== null) candidates.push(cleanUrl_(match[1]));
  var decoded = decodeUrlDeep_(text);
  while ((match = urlPattern.exec(decoded)) !== null) candidates.push(cleanUrl_(match[0]));

  var items = [];
  var lists = [];
  candidates.forEach(function(candidate) {
    var expanded = decodeUrlDeep_(candidate);
    var itemMatch = expanded.match(/https?:\/\/(?:jp\.)?mercari\.com\/(?:item|shops\/product)\/[A-Za-z0-9_-]+/i);
    if (itemMatch) { items.push(normalizeMercariUrl_(itemMatch[0])); return; }
    var idMatch = expanded.match(/(?:^|[^A-Za-z0-9])(m\d{8,})(?:[^A-Za-z0-9]|$)/i);
    if (idMatch) { items.push('https://jp.mercari.com/item/' + idMatch[1]); return; }
    if (/https?:\/\/(?:jp\.)?mercari\.com\//i.test(expanded) && /(?:search|notification|saved|recommend|category|brand)/i.test(expanded)) {
      lists.push(cleanUrl_(expanded));
    }
  });
  return {items:unique_(items), lists:unique_(lists)};
}

function normalizeMercariUrl_(url) {
  var clean = cleanUrl_(url).replace(/^http:\/\//i, 'https://');
  clean = clean.replace(/^https:\/\/mercari\.com\//i, 'https://jp.mercari.com/');
  return clean.split('#')[0].split('?')[0];
}

function cleanUrl_(url) {
  return decodeHtml_(String(url || ''))
    .replace(/[\]\[(){}>,.;]+$/g, '')
    .replace(/&(?:amp;)?$/i, '');
}

function decodeUrlDeep_(value) {
  var current = decodeHtml_(String(value || ''));
  for (var i = 0; i < 4; i++) {
    try {
      var next = decodeURIComponent(current.replace(/\+/g, '%20'));
      if (next === current) break;
      current = next;
    } catch (err) { break; }
  }
  return current;
}

function parseMercariItem_(html, url, context) {
  var title = firstNonEmpty_([
    metaContent_(html, 'property', 'og:title'),
    metaContent_(html, 'name', 'twitter:title'),
    bestJsonString_(html, ['name','itemName','title'], scoreTitle_),
    context ? context.subject : ''
  ]);
  title = cleanTitle_(title);
  var description = bestJsonString_(html, ['description','itemDescription'], scoreDescription_);
  if (!description) description = metaContent_(html, 'property', 'og:description');
  var image = firstNonEmpty_([
    metaContent_(html, 'property', 'og:image'),
    metaContent_(html, 'name', 'twitter:image'),
    bestJsonString_(html, ['image','imageUrl','thumbnail'], scoreImage_)
  ]);
  var price = extractPrice_(html);
  var contextText = context ? (context.subject + '\n' + context.plain + '\n' + stripTags_(context.html)) : '';
  if (!price) price = extractPrice_(contextText);
  if (!description && contextText) description = contextText;
  return buildItem_(url, title, description, image, price, context);
}

function parseMailFallback_(url, context) {
  if (!context) return buildItem_(url, '', '', '', 0, null);
  var text = context.subject + '\n' + context.plain + '\n' + stripTags_(context.html);
  var title = extractNearbyTitle_(context.html, url) || context.subject;
  var image = extractNearbyImage_(context.html, url);
  return buildItem_(url, title, text, image, extractPrice_(text), context);
}

function buildItem_(url, title, description, image, price, context) {
  var cleanDescription = sanitizeDescription_(description);
  var combined = [title, cleanDescription, context ? context.subject : ''].join(' ');
  return {
    url: normalizeMercariUrl_(url),
    title: cleanTitle_(title) || 'メルカリ新着商品',
    description: cleanDescription,
    bodyText: cleanDescription,
    image: cleanUrl_(image),
    images: image ? [cleanUrl_(image)] : [],
    price: Number(price) || 0,
    model: detectModel_(combined),
    storage: detectStorage_(combined),
    color: detectColor_(combined),
    condition: detectCondition_(combined),
    sourceSubject: context ? context.subject : '',
    sourceDate: context && context.date ? context.date.toISOString() : '',
    detailFetched: !!description
  };
}

function fetchItem_(url) {
  var normalized = normalizeMercariUrl_(url);
  if (!/^https:\/\/(?:jp\.)?mercari\.com\/(?:item|shops\/product)\//i.test(normalized)) {
    throw new Error('メルカリ商品URLを確認できません');
  }
  var response = fetchAllSafe_([normalized])[0];
  if (!response || !response.ok) throw new Error('商品ページを取得できませんでした');
  var item = parseMercariItem_(response.text, normalized, null);
  return {item:item};
}

function extractPrice_(text) {
  var source = String(text || '');
  var patterns = [
    /"price"\s*:\s*"?(\d{3,9})"?/i,
    /(?:販売価格|商品価格|価格)[^\d]{0,20}[¥￥]?\s*([\d,]{3,12})\s*円?/i,
    /[¥￥]\s*([\d,]{3,12})/,
    /([\d,]{3,12})\s*円/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var match = source.match(patterns[i]);
    if (match) {
      var value = Number(match[1].replace(/,/g, ''));
      if (value >= 1000 && value <= 999999999) return value;
    }
  }
  return 0;
}

function metaContent_(html, attr, value) {
  var escaped = escapeRegExp_(value);
  var patterns = [
    new RegExp('<meta[^>]*' + attr + '=["\\\']' + escaped + '["\\\'][^>]*content=["\\\']([^"\\\']*)["\\\'][^>]*>', 'i'),
    new RegExp('<meta[^>]*content=["\\\']([^"\\\']*)["\\\'][^>]*' + attr + '=["\\\']' + escaped + '["\\\'][^>]*>', 'i')
  ];
  for (var i = 0; i < patterns.length; i++) {
    var match = String(html || '').match(patterns[i]);
    if (match) return decodeHtml_(match[1]);
  }
  return '';
}

function bestJsonString_(html, keys, scorer) {
  var candidates = [];
  keys.forEach(function(key) {
    var pattern = new RegExp('"' + escapeRegExp_(key) + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"', 'gi');
    var match;
    while ((match = pattern.exec(String(html || ''))) !== null && candidates.length < 120) {
      try { candidates.push(JSON.parse('"' + match[1] + '"')); }
      catch (err) { candidates.push(match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')); }
    }
  });
  candidates = candidates.map(function(value) { return decodeHtml_(value); }).filter(Boolean);
  candidates.sort(function(a, b) { return scorer(b) - scorer(a); });
  return candidates[0] || '';
}

function scoreTitle_(text) {
  var value = String(text || '');
  var score = Math.min(value.length, 100);
  if (/iPhone/i.test(value)) score += 100;
  if (/\d+\s*(?:GB|TB)/i.test(value)) score += 40;
  if (/メルカリ|ログイン|検索|持ち物/i.test(value)) score -= 80;
  return score;
}

function scoreDescription_(text) {
  var value = String(text || '');
  var score = Math.min(value.length, 600);
  if (/バッテリー|付属品|傷|動作|使用|SIM|充放電/i.test(value)) score += 180;
  if (/itemInformation|pageHeading|Mercari ambassador|クレジットカード/i.test(value)) score -= 400;
  return score;
}

function scoreImage_(text) {
  var value = String(text || '');
  var score = /^https?:\/\//i.test(value) ? 100 : 0;
  if (/static|image|mercdn/i.test(value)) score += 30;
  return score;
}

function extractNearbyTitle_(html, url) {
  var source = String(html || '');
  var itemId = itemIdFromUrl_(url);
  var index = itemId ? source.indexOf(itemId) : -1;
  if (index < 0) return '';
  var around = source.slice(Math.max(0, index - 1200), index + 1200);
  var anchor = around.match(/<a[^>]*>[\s\S]*?<\/a>/i);
  return anchor ? stripTags_(anchor[0]).trim() : '';
}

function extractNearbyImage_(html, url) {
  var source = String(html || '');
  var itemId = itemIdFromUrl_(url);
  var index = itemId ? source.indexOf(itemId) : -1;
  if (index < 0) return '';
  var around = source.slice(Math.max(0, index - 1600), index + 1600);
  var image = around.match(/<img[^>]+src=["']([^"']+)["']/i);
  return image ? decodeHtml_(image[1]) : '';
}

function itemIdFromUrl_(url) {
  var match = String(url || '').match(/\/(m\d{8,})(?:[/?#]|$)/i);
  if (match) return match[1].toLowerCase();
  match = String(url || '').match(/\/shops\/product\/([A-Za-z0-9_-]+)/i);
  return match ? 'shop_' + match[1].toLowerCase() : '';
}

function detectModel_(text) {
  var match = String(text || '').match(/iPhone\s*(SE\s*\(?第?[23]世代\)?|(?:1[0-7]|[8X])(?:\s*(?:mini|Plus|Pro\s*Max|Pro|e))?)/i);
  if (!match) return '';
  return ('iPhone ' + match[1]).replace(/\s+/g, ' ').replace(/pro max/i, 'Pro Max').replace(/pro/i, 'Pro').replace(/plus/i, 'Plus').replace(/mini/i, 'mini');
}

function detectStorage_(text) {
  var match = String(text || '').match(/(?:^|\D)(16|32|64|128|256|512)\s*(?:GB|G|ギガ)(?:\D|$)/i);
  if (match) return match[1] + 'GB';
  match = String(text || '').match(/(?:^|\D)(1|2)\s*TB(?:\D|$)/i);
  return match ? match[1] + 'TB' : '';
}

function detectCondition_(text) {
  var conditions = ['新品、未使用','新品・未使用','未使用に近い','目立った傷や汚れなし','やや傷や汚れあり','傷や汚れあり','全体的に状態が悪い'];
  for (var i = 0; i < conditions.length; i++) if (String(text || '').indexOf(conditions[i]) >= 0) return conditions[i].replace('・', '、');
  return '';
}

function detectColor_(text) {
  var colors = ['ブラック','ホワイト','ブルー','グリーン','ピンク','イエロー','パープル','レッド','シルバー','ゴールド','グラファイト','ナチュラルチタニウム','デザートチタニウム','ホワイトチタニウム','ブラックチタニウム','ウルトラマリン','ティール'];
  for (var i = 0; i < colors.length; i++) if (String(text || '').indexOf(colors[i]) >= 0) return colors[i];
  return '';
}

function sanitizeDescription_(text) {
  return stripTags_(String(text || ''))
    .replace(/\\u([0-9a-fA-F]{4})/g, function(_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 5000);
}

function cleanTitle_(text) {
  return decodeHtml_(stripTags_(String(text || '')))
    .replace(/[｜|]\s*メルカリ.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function stripTags_(html) {
  return decodeHtml_(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' '));
}

function decodeHtml_(text) {
  return String(text || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, function(_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi, function(_, n) { return String.fromCharCode(parseInt(n, 16)); });
}

function saveAvgPrices_(raw) {
  var parsed;
  try { parsed = JSON.parse(String(raw || '{}')); }
  catch (err) { throw new Error('中古平均価格データの形式が正しくありません'); }
  var clean = {};
  Object.keys(parsed || {}).slice(0, 500).forEach(function(key) {
    var value = Number(parsed[key]);
    if (value > 0 && value < 10000000) clean[String(key).slice(0, 100)] = Math.round(value);
  });
  var incomingCount = Object.keys(clean).length;
  if (!incomingCount) throw new Error('空の中古平均価格データではGASの保存内容を上書きしません');
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var existing = {};
    try { existing = JSON.parse(props.getProperty(AVG_PRICES_KEY) || '{}'); }
    catch (err) { existing = {}; }
    var merged = {};
    Object.keys(existing || {}).forEach(function(key) {
      var value = Number(existing[key]);
      if (value > 0 && value < 10000000) merged[String(key).slice(0, 100)] = Math.round(value);
    });
    Object.keys(clean).forEach(function(key) { merged[key] = clean[key]; });
    props.setProperty(AVG_PRICES_KEY, JSON.stringify(merged));
    return {saved:incomingCount, total:Object.keys(merged).length, mode:'merge'};
  } finally {
    lock.releaseLock();
  }
}

function getAppConfig_() {
  var raw = PropertiesService.getScriptProperties().getProperty(AVG_PRICES_KEY) || '{}';
  var avgPrices = {};
  try { avgPrices = JSON.parse(raw); } catch (err) { avgPrices = {}; }
  return {avgPrices:avgPrices};
}

function unique_(items) {
  var seen = {};
  return (items || []).filter(function(item) {
    var key = String(item || '');
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function firstNonEmpty_(items) {
  for (var i = 0; i < items.length; i++) if (String(items[i] || '').trim()) return String(items[i]).trim();
  return '';
}

function clamp_(value, min, max, fallback) {
  var number = Number(value);
  if (!isFinite(number)) number = fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function escapeRegExp_(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shortUrl_(url) {
  var value = String(url || '');
  return value.length > 90 ? value.slice(0, 87) + '...' : value;
}
