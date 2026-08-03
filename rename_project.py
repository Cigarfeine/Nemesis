import os
import sys

def replace_in_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except UnicodeDecodeError:
        return # Skip binary files

    new_content = content.replace('NEMESIS', 'NEMESIS')
    new_content = new_content.replace('Nemesis', 'Nemesis')
    new_content = new_content.replace('nemesis', 'nemesis')

    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated content in: {filepath}")

def process_directory(dirpath):
    for root, dirs, files in os.walk(dirpath):
        if '.git' in root or '.venv' in root or '__pycache__' in root:
            continue
            
        # Rename files
        for filename in files:
            filepath = os.path.join(root, filename)
            
            # Skip python script itself
            if filename == 'rename_project.py':
                continue
                
            replace_in_file(filepath)
            
            # Rename file if it contains nemesis
            if 'nemesis' in filename.lower():
                new_filename = filename.replace('nemesis', 'nemesis').replace('Nemesis', 'Nemesis').replace('NEMESIS', 'NEMESIS')
                new_filepath = os.path.join(root, new_filename)
                os.rename(filepath, new_filepath)
                print(f"Renamed {filepath} to {new_filepath}")
                
        # Rename directories
        for dirname in dirs:
            if 'nemesis' in dirname.lower():
                old_dirpath = os.path.join(root, dirname)
                new_dirname = dirname.replace('nemesis', 'nemesis').replace('Nemesis', 'Nemesis').replace('NEMESIS', 'NEMESIS')
                new_dirpath = os.path.join(root, new_dirname)
                os.rename(old_dirpath, new_dirpath)
                print(f"Renamed directory {old_dirpath} to {new_dirpath}")

if __name__ == '__main__':
    process_directory('.')
