<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli') { http_response_code(404); exit; }
require __DIR__.'/backend.php';
// Read a single JSON object from stdin. No secrets in argv, shell history, logs or public files.
try {
    $input=json_decode(stream_get_contents(STDIN),true,32,JSON_THROW_ON_ERROR);
    if(!is_array($input)) throw new RuntimeException('Input must be a JSON object');
    $login=rw_text($input['login']??''); $password=$input['password']??null;
    if(!preg_match('/^[A-Za-z0-9._-]{3,40}$/D',$login) || !is_string($password)) throw new RuntimeException('Invalid login or password');
    $problem=rw_password_problem($password,$login); if($problem) throw new RuntimeException($problem);
    $ips=$input['allowedIps']??[];
    if(!is_array($ips) || !array_is_list($ips) || count($ips)>20) throw new RuntimeException('Invalid IP list');
    foreach($ips as $ip) if(!is_string($ip) || !rw_valid_ip($ip)) throw new RuntimeException('Invalid IP');
    rw_lock('account',function()use($input,$login,$password,$ips){
        if(rw_account() && empty($input['replace'])) throw new RuntimeException('Account exists; explicitly set replace=true to rotate credentials');
        rw_save_account(['login'=>$login,'passwordHash'=>rw_hash_password($password),'sessionSecret'=>bin2hex(random_bytes(32)),'mustChange'=>(bool)($input['mustChange']??false),'allowedIps'=>$ips]);
    });
    fwrite(STDOUT,"Account saved privately; existing sessions revoked.\n");
} catch(Throwable $e) { fwrite(STDERR,$e->getMessage()."\n"); exit(1); }
