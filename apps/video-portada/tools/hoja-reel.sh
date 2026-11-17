#!/bin/sh
# Hoja de contacto de un reel: 12 cuadros repartidos (6×2) a 270×480, con las líneas de la zona segura de Instagram
# (y=220 e y=1600 en el original) y el borde de los botones (x=940 desde y=1100). Uso: tools/hoja-reel.sh <mp4> <png>
d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1")
r=$(echo "12/$d" | bc -l)
ffmpeg -loglevel error -y -i "$1" -vf "fps=$r,drawbox=y=220:w=iw:h=4:color=red@0.7:t=fill,drawbox=y=1600:w=iw:h=4:color=red@0.7:t=fill,drawbox=x=940:y=1100:w=4:h=500:color=red@0.5:t=fill,scale=270:-1,pad=iw+4:ih+4:2:2:white,tile=6x2" -frames:v 1 "$2"
