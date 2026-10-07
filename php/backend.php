<?php
declare(strict_types=1);

// PHP 8.2; no database, Composer, Node service or public credential file.
const RW_SESSION_SECONDS = 43200;
const RW_PASSPORT = ['category'=>40, 'size'=>20, 'brand'=>60, 'era'=>40, 'origin'=>60, 'condition'=>60, 'measures'=>200];
final class RWError extends RuntimeException {
    public function __construct(public int $status, string $message, public array $extra = []) { parent::__construct($message); }
}
function rw_setting(string $name, string $default = ''): string {
    static $settings;
    if ($settings === null) {
        $config = getenv('REWEAR_CONFIG_FILE') ?: (is_file(__DIR__.'/config.local.php') ? __DIR__.'/config.local.php' : __DIR__.'/settings.php');
        $settings = is_file($config) ? require $config : [];
        if (!is_array($settings)) throw new RuntimeException('Invalid PHP settings');
    }
    $env = getenv($name);
    return $env !== false && $env !== '' ? $env : (string)($settings[$name] ?? $default);
}
function rw_docroot(): string { return realpath(rw_setting('REWEAR_DOCROOT', dirname(__DIR__))) ?: throw new RuntimeException('Missing document root'); }
function rw_root(): string {
    static $root;
    if ($root) return $root;
    $path = rw_setting('REWEAR_DATA_DIR', dirname(rw_docroot()).'/rewear-data');
    if ($path === '' || $path[0] !== '/') throw new RuntimeException('REWEAR_DATA_DIR must be absolute');
    if (!is_dir($path) && !mkdir($path, 0700, true)) throw new RuntimeException('Cannot create data root');
    $root = realpath($path);
    if (!$root || $root === rw_docroot() || str_starts_with($root, rw_docroot().'/')) throw new RuntimeException('Data root must be outside document root');
    foreach (['private', 'data', 'images', 'images/preview'] as $dir) {
        $full = $root.'/'.$dir;
        if (is_link($full)) throw new RuntimeException('Unsafe storage symlink');
        if (!is_dir($full) && !mkdir($full, 0700, true)) throw new RuntimeException('Cannot create storage directory');
        if (!str_starts_with(realpath($full).'/', $root.'/')) throw new RuntimeException('Unsafe storage directory');
    }
    return $root;
}
function rw_origin(): string {
    $origin = rtrim(rw_setting('REWEAR_SITE_URL', 'https://rewearvintage.shop'), '/');
    if (!preg_match('~^https://[a-z0-9.-]+(?::[0-9]{1,5})?$~iD', $origin)) throw new RuntimeException('REWEAR_SITE_URL must be an HTTPS origin');
    return $origin;
}
function rw_path(string $rel): string {
    if (!preg_match('~^(?:private/[a-z-]+\.(?:json|lock)|data/products\.json|images/(?:preview/)?[a-z0-9.-]+\.(?:jpg|png|webp))$~D', $rel)) throw new RuntimeException('Unsafe storage path');
    $path = rw_root().'/'.$rel;
    if (is_link($path)) throw new RuntimeException('Unsafe storage symlink');
    return $path;
}
function rw_read(string $rel, mixed $default = null): mixed {
    $path = rw_path($rel);
    if (!file_exists($path)) return $default;
    $raw = file_get_contents($path);
    if ($raw === false) throw new RuntimeException('Cannot read storage');
    return json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
}
function rw_atomic(string $rel, string $bytes): void {
    $path = rw_path($rel); $tmp = $path.'.'.bin2hex(random_bytes(8)).'.tmp';
    $old = umask(0077);
    try {
        $f = fopen($tmp, 'x+b');
        if (!$f) throw new RuntimeException('Cannot create storage file');
        try {
            $offset = 0;
            while ($offset < strlen($bytes)) {
                $n = fwrite($f, substr($bytes, $offset));
                if (!$n) throw new RuntimeException('Cannot write storage file');
                $offset += $n;
            }
            if (!fflush($f)) throw new RuntimeException('Cannot flush storage file');
            if (function_exists('fsync') && !fsync($f)) throw new RuntimeException('Cannot sync storage file');
        } finally { fclose($f); }
        if (!rename($tmp, $path)) throw new RuntimeException('Cannot replace storage file');
    } finally { umask($old); if (file_exists($tmp)) unlink($tmp); }
}
function rw_write(string $rel, mixed $value): void { rw_atomic($rel, json_encode($value, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR)."\n"); }
function rw_lock(string $name, callable $fn): mixed {
    $f = fopen(rw_path('private/'.$name.'.lock'), 'c+b');
    if (!$f || !flock($f, LOCK_EX)) throw new RuntimeException('Cannot lock storage');
    @chmod(rw_path('private/'.$name.'.lock'), 0600);
    try { return $fn(); } finally { flock($f, LOCK_UN); fclose($f); }
}
function rw_json(mixed $data, int $status = 200): never {
    http_response_code($status); header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR); exit;
}
function rw_body(): array {
    $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > 36_000_000) throw new RWError(413, 'Фото: запрос слишком большой.');
    $raw = file_get_contents('php://input', false, null, 0, 36_000_001);
    if ($raw === false || strlen($raw) > 36_000_000) throw new RWError(413, 'Фото: запрос слишком большой.');
    if ($raw === '') return [];
    try { $object = json_decode($raw, false, 64, JSON_THROW_ON_ERROR); } catch (JsonException) { throw new RWError(400, 'Неверный JSON.'); }
    if (!$object instanceof stdClass) throw new RWError(400, 'Неверный JSON: нужен объект.');
    return json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
}
function rw_same_origin(): void {
    if (isset($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] !== rw_origin()) throw new RWError(403, 'Запрос отклонён.');
    if (isset($_SERVER['HTTP_SEC_FETCH_SITE']) && !in_array($_SERVER['HTTP_SEC_FETCH_SITE'], ['same-origin','none'], true)) throw new RWError(403, 'Запрос отклонён.');
    if (!in_array($_SERVER['REQUEST_METHOD'], ['GET','HEAD'], true) && !preg_match('~^application/json(?:\s*;|$)~i', $_SERVER['CONTENT_TYPE'] ?? '')) throw new RWError(403, 'Запрос отклонён.');
}
function rw_ip(): string {
    $peer = preg_replace('/^::ffff:/', '', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $trusted = array_filter(array_map('trim', explode(',', rw_setting('REWEAR_TRUSTED_PROXIES'))));
    // Set this only after verifying the host's nginx overwrites/appends X-Forwarded-For.
    if (!in_array($peer, $trusted, true)) return $peer;
    $chain = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
    if (count($chain) > 20) return $peer;
    foreach (array_reverse($chain) as $candidate) {
        $candidate = preg_replace('/^::ffff:/', '', trim($candidate));
        if (!filter_var($candidate, FILTER_VALIDATE_IP)) return $peer;
        if (!in_array($candidate, $trusted, true)) return $candidate;
    }
    return $peer;
}
function rw_valid_ip(string $pattern): bool {
    if (filter_var($pattern, FILTER_VALIDATE_IP)) return true;
    if (preg_match('/^((?:[0-9]{1,3}\.){1,3})\*$/D', $pattern, $m)) {
        foreach (explode('.', rtrim($m[1], '.')) as $part) if ((int)$part > 255) return false;
        return true;
    }
    return (bool)preg_match('/^[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){1,7}:\*$/iD', $pattern);
}
function rw_ip_allowed(array $account, string $ip): bool {
    $list = $account['allowedIps'] ?? [];
    if (!$list) return true;
    foreach ($list as $pattern) {
        if (!is_string($pattern) || !rw_valid_ip($pattern)) continue;
        if (str_ends_with($pattern, '*') ? str_starts_with($ip, substr($pattern, 0, -1)) : (inet_pton($ip) !== false && inet_pton($ip) === inet_pton($pattern))) return true;
    }
    return false;
}
function rw_account(): ?array {
    $a = rw_read('private/admin.json');
    if (!is_array($a) || !is_string($a['login'] ?? null) || !is_string($a['passwordHash'] ?? null) || !is_string($a['sessionSecret'] ?? null) || strlen($a['sessionSecret']) < 32) return null;
    return array_merge(['allowedIps'=>[], 'mustChange'=>false, 'version'=>'file'], $a);
}
function rw_save_account(array $a): array {
    unset($a['source']); $a['version'] = bin2hex(random_bytes(16)); $a['updatedAt'] = gmdate('Y-m-d\TH:i:s\Z');
    rw_write('private/admin.json', $a); return $a;
}
function rw_b64(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function rw_session(array $a): string {
    $payload = rw_b64(json_encode(['exp'=>time()+RW_SESSION_SECONDS, 'v'=>$a['version']], JSON_THROW_ON_ERROR));
    return $payload.'.'.rw_b64(hash_hmac('sha256', $payload, $a['sessionSecret'], true));
}
function rw_cookie(string $token): void {
    header('Set-Cookie: admin_session='.$token.'; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age='.($token ? RW_SESSION_SECONDS : 0));
}
function rw_authenticated(): array {
    $a = rw_account(); $token = $_COOKIE['admin_session'] ?? '';
    if (!$a || !is_string($token) || strlen($token) > 1024) throw new RWError(401, 'Войдите в админ-панель.');
    $parts = explode('.', $token);
    if (count($parts) !== 2 || !preg_match('/^[A-Za-z0-9_-]+$/D', $parts[0]) || !hash_equals(rw_b64(hash_hmac('sha256', $parts[0], $a['sessionSecret'], true)), $parts[1])) throw new RWError(401, 'Войдите в админ-панель.');
    $payload = json_decode(base64_decode(strtr($parts[0], '-_', '+/'), true) ?: '', true);
    if (!is_array($payload) || !is_int($payload['exp'] ?? null) || $payload['exp'] <= time() || ($payload['v'] ?? null) !== $a['version'] || !rw_ip_allowed($a, rw_ip())) throw new RWError(401, 'Войдите в админ-панель.');
    return $a;
}
function rw_verify_password(mixed $password, string $hash): bool {
    if (!is_string($password) || strlen($password) > 4096) return false;
    if (!str_starts_with($hash, 'scrypt$')) return str_starts_with($hash, '$2') && strlen($password)>72 ? false : password_verify($password, $hash);
    if (!preg_match('/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/D', $hash)) return false;
    $node = rw_setting('REWEAR_SCRYPT_NODE', '/usr/bin/node10');
    if (!is_executable($node) || !function_exists('proc_open')) return false;
    // Password and hash are passed through stdin, never argv, shell interpolation or logs.
    $p = proc_open([$node, __DIR__.'/verify-scrypt.cjs'], [['pipe','r'], ['pipe','w'], ['pipe','w']], $pipes);
    if (!is_resource($p)) return false;
    fwrite($pipes[0], json_encode(['password'=>$password, 'hash'=>$hash], JSON_THROW_ON_ERROR)); fclose($pipes[0]);
    $output = stream_get_contents($pipes[1], 16); fclose($pipes[1]); stream_get_contents($pipes[2], 1024); fclose($pipes[2]);
    $code = proc_close($p); return $code === 0 && $output === 'OK';
}
function rw_password_algorithm(): string|int { return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT; }
function rw_hash_password(string $password): string {
    if (rw_password_algorithm() === PASSWORD_BCRYPT && strlen($password)>72) throw new RWError(400,'Пароль: не больше 72 байт на этом сервере.');
    return password_hash($password,rw_password_algorithm());
}
function rw_guard(string $ip, string $action = 'state', bool $trusted = false): array {
    return rw_lock('throttle', function() use ($ip, $action, $trusted) {
        $s = rw_read('private/throttle.json', ['ips'=>[], 'all'=>[]]);
        if (!is_array($s) || !is_array($s['ips'] ?? null) || !is_array($s['all'] ?? null)) throw new RuntimeException('Invalid throttle state');
        $now = time();
        foreach ($s['ips'] as $key=>$times) { $times = array_values(array_filter($times, fn($n)=>is_int($n) && $n > $now-86400)); if ($times) $s['ips'][$key]=$times; else unset($s['ips'][$key]); }
        $s['all'] = array_values(array_filter($s['all'], fn($n)=>is_int($n) && $n > $now-900));
        if ($action === 'failure') { $s['ips'][$ip][]=$now; $s['all'][]=$now; }
        if ($action === 'clear') unset($s['ips'][$ip]);
        $times = $s['ips'][$ip] ?? []; $recent = array_values(array_filter($times, fn($n)=>$n > $now-900));
        $result = ['blocked'=>false, 'minutes'=>0, 'reason'=>'', 'delay'=>min(4000, count($recent)*800), 'left'=>max(0,5-count($recent))];
        if (count($times)>=15) $result = array_merge($result,['blocked'=>true,'minutes'=>max(1,(int)ceil(($times[count($times)-15]+86400-$now)/60)),'reason'=>'day']);
        elseif (count($recent)>=5) $result = array_merge($result,['blocked'=>true,'minutes'=>max(1,(int)ceil(($recent[count($recent)-5]+900-$now)/60)),'reason'=>'ip']);
        elseif (!$trusted && count($s['all'])>=20) $result = array_merge($result,['blocked'=>true,'minutes'=>max(1,(int)ceil(($s['all'][count($s['all'])-20]+900-$now)/60)),'reason'=>'global']);
        rw_write('private/throttle.json', $s); return $result;
    });
}
function rw_password_problem(string $password, string $login): string {
    $len = rw_len($password); $lower = function_exists('mb_strtolower') ? mb_strtolower($password, 'UTF-8') : strtolower($password);
    if ($len < 12) return 'Пароль: не короче 12 символов.';
    if ($len > 1024) return 'Пароль: не больше 1024 символов.';
    if ($login && str_contains($lower, strtolower($login))) return 'Пароль не должен содержать логин.';
    foreach (['password','пароль','qwerty','йцукен','123456','111111','admin','rewear','vintage','letmein'] as $word) if (str_contains($lower,$word)) return 'Пароль слишком простой: уберите очевидные слова.';
    if (count(array_unique(preg_split('//u',$password,-1,PREG_SPLIT_NO_EMPTY)))<6) return 'Пароль слишком однообразный: используйте больше разных символов.';
    $kinds=0; foreach (['/[a-zа-яё]/u','/[A-ZА-ЯЁ]/u','/\d/u','/[^\p{L}\d]/u'] as $re) $kinds+=(bool)preg_match($re,$password);
    if ($len<16 && $kinds<3) return 'Пароль короче 16 символов должен сочетать хотя бы три вида: строчные, заглавные буквы, цифры, знаки.';
    return '';
}
function rw_len(string $s): int { return preg_match_all('/./us', $s); }
function rw_text(mixed $value): string { if (!is_string($value) && !is_int($value) && !is_float($value) && $value !== null) throw new RWError(400,'Неверный формат поля.'); return trim((string)$value); }
function rw_fields(array $body): array {
    $title=rw_text($body['title'] ?? ''); $description=rw_text($body['description'] ?? ''); $price=$body['price'] ?? null;
    if (!$title || rw_len($title)>100) throw new RWError(400,'Название: от 1 до 100 символов.');
    if ((!is_int($price) && !is_float($price) && !is_string($price)) || !is_numeric($price) || !is_finite((float)$price) || (float)$price !== (float)(int)$price || (int)$price<=0 || (int)$price>10000000) throw new RWError(400,'Цена: целое число больше нуля.');
    if (rw_len($description)>1000) throw new RWError(400,'Описание: не больше 1000 символов.');
    $result=['title'=>$title,'price'=>(int)$price,'description'=>$description];
    foreach (RW_PASSPORT as $name=>$max) {
        $value=rw_text($body[$name] ?? '');
        if (rw_len($value)>$max) throw new RWError(400,'Поле «'.$name.'» длиннее '.$max.' символов.');
        if ($name==='category' && $value && !in_array($value,['Верхняя одежда','Штаны','Обувь','Аксессуары'],true)) throw new RWError(400,'Поле «category»: выберите из списка.');
        $result[$name]=$value;
    }
    return $result;
}
function rw_notes(mixed $notes, int $count): array {
    if (!is_array($notes) || !array_is_list($notes) || count($notes)>12) throw new RWError(400,'Детали: не больше 12 точек.');
    $out=[];
    foreach ($notes as $note) {
        if (!is_array($note)) throw new RWError(400,'Детали: неверная точка.');
        $x=$note['x']??null; $y=$note['y']??null; $img=$note['img']??0; $text=rw_text($note['text']??'');
        if (!is_numeric($x) || !is_numeric($y) || $x<0 || $x>100 || $y<0 || $y>100) throw new RWError(400,'Детали: точка вне фото.');
        if ((!is_int($img) && !is_string($img)) || !is_numeric($img) || (float)$img!=(int)$img || $img<0 || $img>=max($count,1)) throw new RWError(400,'Детали: точка ссылается на несуществующее фото.');
        if (!$text || rw_len($text)>80) throw new RWError(400,'Детали: текст от 1 до 80 символов.');
        $out[]=['x'=>round((float)$x,1),'y'=>round((float)$y,1),'img'=>(int)$img,'type'=>($note['type']??'')==='flaw'?'flaw':'detail','text'=>$text];
    }
    return $out;
}
function rw_id(mixed $id): string { if (!is_string($id) || !preg_match('/^[a-z0-9-]{1,60}$/D',$id)) throw new RWError(400,'Неверный ID товара.'); return $id; }
function rw_images(array $p): array { return !empty($p['images']) && is_array($p['images']) ? $p['images'] : (!empty($p['image']) ? [$p['image']] : []); }
function rw_image(mixed $data, bool $preview): array {
    $regex=$preview ? '~^data:image/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$~D' : '~^data:image/(jpeg);base64,([A-Za-z0-9+/]+={0,2})$~D';
    if (!is_string($data) || !preg_match($regex,$data,$m)) throw new RWError(400,$preview?'Фото превью: нужен WebP или PNG.':'Фото должно быть в формате JPEG.');
    $bytes=base64_decode($m[2],true); $limit=$preview?2000000:3000000;
    if ($bytes===false || base64_encode($bytes)!==$m[2]) throw new RWError(400,'Файл: неверный base64.');
    if (strlen($bytes)>$limit) throw new RWError(400,$preview?'Фото превью больше 2 МБ.':'Фото больше 3 МБ.');
    $info=@getimagesizefromstring($bytes); $type=['jpeg'=>IMAGETYPE_JPEG,'png'=>IMAGETYPE_PNG,'webp'=>IMAGETYPE_WEBP][$m[1]];
    if (!$info || $info[2]!==$type || $info[0]<1 || $info[1]<1 || $info[0]>12000 || $info[1]>12000 || $info[0]*$info[1]>40000000) throw new RWError(400,'Файл не похож на изображение или слишком большое разрешение.');
    return [$bytes,$m[1]==='jpeg'?'jpg':$m[1]];
}
function rw_photo_plan(mixed $list,string $id,array $current,array &$writes): array {
    if (!is_array($list) || !array_is_list($list) || count($list)>8) throw new RWError(400,'Фото: не больше 8.');
    $out=[];
    foreach ($list as $item) {
        if (is_string($item) && in_array($item,$current,true)) $out[]=$item;
        else { [$bytes,$ext]=rw_image($item,false); $path='images/'.$id.'-'.bin2hex(random_bytes(8)).'.'.$ext; $writes[$path]=$bytes; $out[]='/'.$path; }
    }
    return $out;
}
function rw_preview_plan(mixed $value,string $id,array &$writes): string {
    if ($value==='' || $value===null) return '';
    [$bytes,$ext]=rw_image($value,true); $path='images/preview/'.$id.'-'.bin2hex(random_bytes(8)).'.'.$ext; $writes[$path]=$bytes; return '/'.$path;
}
function rw_delete_photo(mixed $path): void {
    if (!is_string($path) || !preg_match('~^/images/(?:preview/)?[a-z0-9.-]+\.(?:jpg|png|webp)$~D',$path) || str_contains($path,'..')) return;
    $file=rw_path(substr($path,1)); if (is_file($file) && !unlink($file)) error_log('REWEAR: unused image cleanup failed');
}
function rw_catalog(): array {
    $catalog=rw_read('data/products.json', []);
    if (!is_array($catalog) || !array_is_list($catalog)) throw new RuntimeException('Invalid catalog');
    foreach ($catalog as $p) if (!is_array($p) || !isset($p['id']) || !is_string($p['id'])) throw new RuntimeException('Invalid product');
    return $catalog;
}
function rw_products(string $method,array $body): array {
    if ($method==='GET') return ['products'=>rw_catalog()];
    if (!in_array($method,['POST','PUT','DELETE'],true)) throw new RWError(405,'Метод не поддерживается.');
    return rw_lock('catalog', function() use($method,$body) {
        $products=rw_catalog(); $writes=[]; $removed=[];
        $incoming=array_key_exists('images',$body)?$body['images']:(array_key_exists('image',$body)?($body['image']?[$body['image']]:[]):null);
        $hasImages=array_key_exists('images',$body)||array_key_exists('image',$body);
        if ($method==='POST') {
            $id='p-'.base_convert((string)(int)(microtime(true)*1000),10,36).'-'.bin2hex(random_bytes(4));
            $p=array_merge(['id'=>$id],rw_fields($body));
            $images=$hasImages?rw_photo_plan($incoming,$id,[],$writes):[];
            $p=array_merge($p,['image'=>$images[0]??'','images'=>$images,'notes'=>array_key_exists('notes',$body)?rw_notes($body['notes'],count($images)):[], 'active'=>true,'sold'=>false,'reserved'=>false,'createdAt'=>gmdate('Y-m-d\TH:i:s\Z')]);
            if (array_key_exists('preview',$body) && $body['preview']!==null && $body['preview']!=='') $p['preview']=rw_preview_plan($body['preview'],$id,$writes);
            array_unshift($products,$p);
        } else {
            $id=rw_id($_GET['id']??$body['id']??null); $index=null;
            foreach ($products as $i=>$p) if ($p['id']===$id) { $index=$i; break; }
            if ($index===null) throw new RWError(404,'Товар не найден.');
            $p=$products[$index];
            if ($method==='DELETE') { array_splice($products,$index,1); $removed=array_merge(rw_images($p),[$p['preview']??'']); }
            else {
                if (array_intersect(array_keys($body),array_merge(['title','price','description'],array_keys(RW_PASSPORT)))) $p=array_merge($p,rw_fields(array_merge($p,$body)));
                foreach (['active','sold','reserved'] as $flag) if (array_key_exists($flag,$body)) { if (!is_bool($body[$flag])) throw new RWError(400,'Поле «'.$flag.'»: нужен логический тип.'); $p[$flag]=$body[$flag]; }
                if (array_key_exists('preview',$body)) {
                    $before=$p['preview']??''; $next=rw_preview_plan($body['preview'],$id,$writes);
                    if ($next) $p['preview']=$next; else unset($p['preview']);
                    if ($before && $before!==$next) $removed[]=$before;
                }
                if ($hasImages) { $before=rw_images($p); $p['images']=rw_photo_plan($incoming,$id,$before,$writes); $p['image']=$p['images'][0]??''; $removed=array_merge($removed,array_diff($before,$p['images'])); }
                $count=count(rw_images($p));
                if (array_key_exists('notes',$body)) $p['notes']=rw_notes($body['notes'],$count);
                elseif (isset($p['notes']) && is_array($p['notes'])) $p['notes']=array_values(array_filter($p['notes'],fn($n)=>($n['img']??0)<$count));
                $products[$index]=$p;
            }
        }
        $saved=[];
        try {
            foreach ($writes as $path=>$bytes) { rw_atomic($path,$bytes); $saved[]='/'.$path; }
            rw_write('data/products.json',$products);
        } catch (Throwable $e) { foreach ($saved as $path) rw_delete_photo($path); throw $e; }
        $used=[]; foreach ($products as $p) $used=array_merge($used,rw_images($p),[$p['preview']??'']);
        foreach ($removed as $path) if (!in_array($path,$used,true)) rw_delete_photo($path);
        return ['products'=>$products];
    });
}
function rw_account_view(array $a): array { return ['login'=>$a['login'],'mustChange'=>(bool)$a['mustChange'],'allowedIps'=>$a['allowedIps'],'ip'=>rw_ip(),'updatedAt'=>$a['updatedAt']??null]; }
function rw_api(string $route): never {
    header('Cache-Control: no-store'); rw_same_origin(); $method=$_SERVER['REQUEST_METHOD'];
    if ($route==='login') {
        if ($method!=='POST') throw new RWError(405,'Метод не поддерживается.');
        $body=rw_body(); $a=rw_account(); if (!$a) throw new RWError(503,'Вход ещё не настроен. Настройте приватный аккаунт на сервере.');
        $ip=rw_ip(); $trusted=!empty($a['allowedIps']) && rw_ip_allowed($a,$ip); $guard=rw_guard($ip,'state',$trusted);
        if ($guard['blocked']) throw new RWError(429,'Слишком много неверных попыток. Попробуйте через '.$guard['minutes'].' мин.');
        if (!rw_ip_allowed($a,$ip)) { rw_guard($ip,'failure'); throw new RWError(403,'Вход с вашего IP ('.$ip.') запрещён настройками безопасности.'); }
        if ($guard['delay']) usleep($guard['delay']*1000);
        $result=rw_lock('account',function()use($body,$ip){
            $a=rw_account(); if (!$a) throw new RWError(503,'Вход ещё не настроен.');
            $guard=rw_guard($ip,'state',!empty($a['allowedIps']) && rw_ip_allowed($a,$ip));
            if($guard['blocked']) throw new RWError(429,'Слишком много неверных попыток. Попробуйте через '.$guard['minutes'].' мин.');
            $ok=rw_verify_password($body['password']??'',$a['passwordHash']);
            $login=$body['login']??'';
            if (!$ok || !is_string($login) || !hash_equals($a['login'],$login) || !rw_ip_allowed($a,$ip)) {
                $state=rw_guard($ip,'failure'); throw new RWError(401,$state['left']?'Неверный логин или пароль. Осталось попыток: '.$state['left'].'.':'Неверный логин или пароль. Вход с вашего IP заблокирован на 15 минут.');
            }
            if (str_starts_with($a['passwordHash'],'scrypt$') || password_needs_rehash($a['passwordHash'],rw_password_algorithm())) {
                $a['passwordHash']=rw_hash_password($body['password']); $a['sessionSecret']=bin2hex(random_bytes(32)); $a=rw_save_account($a);
            }
            rw_guard($ip,'clear'); rw_cookie(rw_session($a)); return ['ok'=>true,'mustChange'=>(bool)$a['mustChange']];
        });
        rw_json($result);
    }
    if ($route==='logout') { if ($method!=='POST') throw new RWError(405,'Метод не поддерживается.'); rw_cookie(''); rw_json(['ok'=>true]); }
    if (!in_array($route,['account','products'],true)) throw new RWError(404,'Не найдено.');
    // A concurrent password change cannot race with a mutation authenticated against stale credentials.
    $result=rw_lock('account',function()use($route,$method){
        $a=rw_authenticated();
        if ($route==='products') { if ($a['mustChange']) throw new RWError(403,'Сначала смените временный пароль.',['mustChange'=>true]); return rw_products($method,in_array($method,['POST','PUT','DELETE'],true)?rw_body():[]); }
        if ($method==='GET') return rw_account_view($a);
        if ($method!=='PUT') throw new RWError(405,'Метод не поддерживается.');
        $body=rw_body(); $ip=rw_ip(); $guard=rw_guard($ip,'state',true);
        if ($guard['blocked']) throw new RWError(429,'Слишком много неудачных попыток. Попробуйте через '.$guard['minutes'].' мин.');
        if (!rw_verify_password($body['currentPassword']??'',$a['passwordHash'])) { rw_guard($ip,'failure'); throw new RWError(400,'Текущий пароль указан неверно.'); }
        rw_guard($ip,'clear'); $login=rw_text($body['login']??$a['login']);
        if (!preg_match('/^[A-Za-z0-9._-]{3,40}$/D',$login)) throw new RWError(400,'Логин: от 3 до 40 символов, латиница, цифры, точка, дефис, подчёркивание.');
        $password=$body['password']??'';
        if (!is_string($password)) throw new RWError(400,'Неверный пароль.');
        $changed=$password!=='';
        if ($changed) {
            $problem=rw_password_problem($password,$login); if ($problem) throw new RWError(400,$problem);
            if (rw_verify_password($password,$a['passwordHash'])) throw new RWError(400,'Новый пароль совпадает с текущим.');
            $a['passwordHash']=rw_hash_password($password);
        } elseif ($a['mustChange']) throw new RWError(400,'Это временный пароль: задайте новый.');
        if (array_key_exists('allowedIps',$body)) {
            if (!is_array($body['allowedIps']) || !array_is_list($body['allowedIps'])) throw new RWError(400,'Список IP: до 20 адресов вида 85.140.12.7 или 85.140.*.');
            $list=[]; foreach($body['allowedIps'] as $v) { if(!is_string($v)) throw new RWError(400,'Неверный IP.'); $v=trim($v); if($v!=='' && !in_array($v,$list,true)) $list[]=$v; }
            if(count($list)>20 || array_filter($list,fn($v)=>!rw_valid_ip($v))) throw new RWError(400,'Список IP: до 20 адресов вида 85.140.12.7 или 85.140.*.');
            if(!rw_ip_allowed(['allowedIps'=>$list],$ip)) throw new RWError(400,'Ваш текущий IP ('.$ip.') не входит в список: вы потеряете доступ. Добавьте его.');
            $a['allowedIps']=$list;
        }
        if($changed || $login!==$a['login']) $a['sessionSecret']=bin2hex(random_bytes(32));
        $a['login']=$login; $a['mustChange']=false; $a=rw_save_account($a); rw_cookie(rw_session($a));
        return array_merge(rw_account_view($a),['saved'=>true]);
    });
    rw_json($result);
}
function rw_public(): array { return array_values(array_filter(rw_catalog(),fn($p)=>!empty($p['active']))); }
function rw_escape(mixed $s): string { return htmlspecialchars((string)$s,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8'); }
function rw_share(string $id): never {
    $product=null;
    if(preg_match('/^[a-z0-9-]{1,60}$/D',$id)) foreach(rw_public() as $p) if($p['id']===$id) { $product=$p; break; }
    $photo='/og.jpg'; if($product) foreach(rw_images($product) as $src) if(is_string($src) && preg_match('~^/images/[a-z0-9.-]+\.jpg$~D',$src) && !str_contains($src,'..')) { $photo=$src; break; }
    $title=$product?$product['title'].' — '.(!empty($product['sold'])?'ушло':number_format((float)$product['price'],0,',',' ').' ₽').' · REWEAR VINTAGE':'REWEAR VINTAGE — винтаж в единственном экземпляре';
    $description=$product?(implode(' · ',array_filter([$product['brand']??'', $product['era']??'', $product['condition']??''])) ?: ($product['description'] ?: 'Винтаж в единственном экземпляре')):'Каждая вещь одна. Паспорт, детали и дефекты на фото. Заказ в Telegram.';
    $target=$product?'/?product='.rawurlencode($id):'/';
    header('Content-Type: text/html; charset=utf-8'); header('Cache-Control: no-cache');
    echo '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>'.rw_escape($title).'</title><meta name="viewport" content="width=device-width,initial-scale=1">';
    foreach(['og:type'=>$product?'product':'website','og:site_name'=>'REWEAR VINTAGE','og:title'=>$title,'og:description'=>$description,'og:image'=>rw_origin().$photo,'og:url'=>rw_origin().($product?'/p/'.$id:'/')] as $name=>$value) echo '<meta property="'.$name.'" content="'.rw_escape($value).'">';
    echo '<meta name="twitter:card" content="summary_large_image"><meta http-equiv="refresh" content="0;url='.rw_escape($target).'"></head><body><p><a href="'.rw_escape($target).'">Открыть в каталоге</a></p><script>location.replace('.json_encode($target,JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT).');</script></body></html>'; exit;
}
function rw_sitemap(): never {
    $urls=[rw_origin().'/',rw_origin().'/sold/']; foreach(rw_public() as $p) if(empty($p['sold']) && preg_match('/^[a-z0-9-]{1,60}$/D',$p['id'])) $urls[]=rw_origin().'/p/'.$p['id'];
    header('Content-Type: application/xml; charset=utf-8'); header('Cache-Control: no-cache'); echo '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
    foreach($urls as $url) echo '<url><loc>'.rw_escape($url).'</loc></url>'; echo '</urlset>'; exit;
}
function rw_serve_image(string $path): never {
    if(!preg_match('~^/images/(?:preview/)?[a-z0-9.-]+\.(jpg|png|webp)$~D',$path,$m) || str_contains($path,'..')) throw new RWError(404,'Не найдено.');
    $file=rw_path(substr($path,1)); if(!is_file($file)) throw new RWError(404,'Не найдено.');
    header('Content-Type: '.['jpg'=>'image/jpeg','png'=>'image/png','webp'=>'image/webp'][$m[1]]); header('Content-Length: '.filesize($file)); header('Cache-Control: public, max-age=31536000, immutable');
    if($_SERVER['REQUEST_METHOD']!=='HEAD') readfile($file); exit;
}
function rw_dispatch(): never {
    header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: strict-origin-when-cross-origin');
    try {
        $raw=explode('?',$_SERVER['REQUEST_URI']??'/',2)[0]; $path=rawurldecode($raw);
        if(str_contains($path,"\0") || str_contains($path,'\\') || preg_match('~(?:^|/)\.{1,2}(?:/|$)~',$path)) throw new RWError(404,'Не найдено.');
        if(preg_match('~^/api/admin/([a-z]+)$~D',$path,$m)) rw_api($m[1]);
        if(!in_array($_SERVER['REQUEST_METHOD'],['GET','HEAD'],true)) throw new RWError(405,'Метод не поддерживается.');
        if($path==='/data/products.json') { header('Cache-Control: no-store'); rw_json(rw_public()); }
        if(str_starts_with($path,'/images/')) rw_serve_image($path);
        if($path==='/sitemap.xml' || $path==='/api/sitemap') rw_sitemap();
        if(preg_match('~^/p/([^/]+)$~D',$path,$m)) rw_share($m[1]);
        if($path==='/api/share') rw_share(is_string($_GET['id']??null)?$_GET['id']:'');
        throw new RWError(404,'Не найдено.');
    } catch(RWError $e) { rw_json(array_merge(['error'=>$e->getMessage()],$e->extra),$e->status); }
    catch(Throwable $e) { error_log('REWEAR backend: '.$e->getMessage()); rw_json(['error'=>'Не удалось сохранить на сервере. Проверьте права на папку данных.'],500); }
}
