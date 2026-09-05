Add-Type -AssemblyName System.Speech

$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $projectRoot 'assets\audio'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$words = @(
  'disappear','disability','disarm','disapproval','unacceptable',
  'unbearable','unexpected','affordable','foreseeable','reliable',
  'combination','invitation','innovation','revolution','video',
  'view','visit','vision','visionary','defect',
  'infect','effect','abolish','abolition','abound',
  'absence','absorb','abundant','abuse','academic',
  'access','accomplish','account','accurate','addict',
  'adopt','adjust','address','adapt','adverse',
  'affect','alleviate','allocate','alternative','approve',
  'appraisal','apply','assess','available','budget'
)

$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice.SelectVoice('Microsoft Zira Desktop')
$voice.Rate = -1
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  8000,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono
)

for ($index = 0; $index -lt $words.Count; $index++) {
  $id = 'c-1-{0}' -f ($index + 1)
  $path = Join-Path $outputDir ($id + '.wav')
  $voice.SetOutputToWaveFile($path, $format)
  $voice.Speak($words[$index])
}

$voice.SetOutputToNull()
$voice.Dispose()
Write-Output ('generated={0}; directory={1}' -f $words.Count, $outputDir)
