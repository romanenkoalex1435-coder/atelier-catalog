<?php
// Development only: php -S 127.0.0.1:8080 php/router.php
// Explicit static allowlist; never return false (PHP's built-in server can execute source files).
declare(strict_types=1);
require __DIR__.'/backend.php';
$path=rawurldecode(explode('?',$_SERVER['REQUEST_URI']??'/',2)[0]);
$aliases=['/'=>'/index.html','/admin'=>'/admin/index.html','/admin/'=>'/admin/index.html','/sold'=>'/sold/index.html','/sold/'=>'/sold/index.html'];
$static=$aliases[$path]??$path;
$allowed=['/index.html','/admin/index.html','/admin/admin.js','/admin/admin.css','/admin/cutout.js','/sold/index.html','/app.js','/styles.css','/favicon.svg','/og.jpg','/robots.txt','/manifest.webmanifest','/favicon.png','/apple-touch-icon.png','/config.json'];
$asset = preg_match('~^/(?:fonts/[a-zA-Z0-9.-]+\.(?:woff2|txt)|video/[a-zA-Z0-9.-]+\.mp4|models/[a-zA-Z0-9.-]+\.onnx|vendor/ort/[a-zA-Z0-9.-]+\.(?:mjs|wasm))$~D',$static) && !str_contains($static,'..');
if((in_array($static,$allowed,true) || $asset) && in_array($_SERVER['REQUEST_METHOD'],['GET','HEAD'],true)) {
    $file=rw_docroot().$static;
    if(is_file($file) && !is_link($file)) {
        $types=['html'=>'text/html; charset=utf-8','js'=>'text/javascript; charset=utf-8','css'=>'text/css; charset=utf-8','svg'=>'image/svg+xml','jpg'=>'image/jpeg','txt'=>'text/plain; charset=utf-8','webmanifest'=>'application/manifest+json','json'=>'application/json','png'=>'image/png','woff2'=>'font/woff2','mp4'=>'video/mp4','onnx'=>'application/octet-stream','mjs'=>'text/javascript; charset=utf-8','wasm'=>'application/wasm'];
        header('Content-Type: '.$types[pathinfo($file,PATHINFO_EXTENSION)]); header('X-Content-Type-Options: nosniff');
        if($_SERVER['REQUEST_METHOD']!=='HEAD') readfile($file); exit;
    }
}
rw_dispatch();
